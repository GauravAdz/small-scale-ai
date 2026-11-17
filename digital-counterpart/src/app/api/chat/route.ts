import { createUIMessageStream, createUIMessageStreamResponse, type UIMessageStreamWriter } from "ai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";

import {
  captureTurnAnalytics,
  structuredInterpretationAnalytics,
  type TurnAnalytics,
} from "@/lib/analytics/posthog";
import { answerPortfolioQuestion } from "@/lib/chat/pipeline";
import type { TurnStatus } from "@/lib/chat/visual-types";
import { readEnv, type EnvConfig } from "@/lib/config";
import { chatErrorResponse, publicChatErrorMessage, VERIFICATION_UNAVAILABLE_MESSAGE } from "@/lib/chat/error-response";
import { loadProfile, loadProjects } from "@/lib/knowledge/loader";
import { getRetriever } from "@/lib/rag/retriever";
import { clientKey, getRateLimiter } from "@/lib/rate-limit";
import type { CounterpartMessage } from "@/types/chat";
import { traced, TRACE_NAMES } from "@/lib/observability/tracing";
import type { VerificationEvent } from "@/lib/observability/verification";
import { RELIABILITY_VERSIONS } from "@/lib/versions";

export const runtime = "nodejs";
// A 5-second interpretation fallback, three 20-second verification calls, and
// one bounded voice/review pass fit inside the request deadline.
export const maxDuration = 90;

const requestSchema = z.object({
  messages: z
    .array(
      z
        .object({
          id: z.string().optional(),
          role: z.enum(["user", "assistant"]),
          parts: z.array(
            z.object({
              type: z.string(),
              text: z.string().max(10_000).optional(),
            }),
          ),
        })
        .passthrough(),
    )
    .min(1),
});

function fail(message: string, status: number, headers?: HeadersInit): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...headers },
  });
}

function textOf(message: CounterpartMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim();
}

function writeStatus(writer: UIMessageStreamWriter<CounterpartMessage>, status: TurnStatus): void {
  writer.write({ type: "data-status", id: "status", data: status });
}

function writeText(writer: UIMessageStreamWriter<CounterpartMessage>, text: string): void {
  writer.write({ type: "text-start", id: "answer" });
  writer.write({ type: "text-delta", id: "answer", delta: text });
  writer.write({ type: "text-end", id: "answer" });
}

function recordDiagnostic(
  diagnostics: Record<string, string | number>,
  event: VerificationEvent,
): void {
  if (event.value !== undefined) {
    diagnostics[event.name] = Number(diagnostics[event.name] ?? 0) + event.value;
  } else {
    diagnostics[event.name] = Number(diagnostics[event.name] ?? 0) + 1;
  }
  if (["semantic_recovery_attempted", "verification_llm", "renderer_llm", "renderer_review_llm"].includes(event.name)) {
    diagnostics.llm_call_count = Number(diagnostics.llm_call_count ?? 0) + 1;
  }
  if (["input_tokens", "output_tokens", "cached_input_tokens"].includes(event.name)) {
    const role = event.modelRole ?? "verifier";
    diagnostics[`${role}_${event.name}`] = Number(diagnostics[`${role}_${event.name}`] ?? 0) + (event.value ?? 0);
  }
  if (event.domain) diagnostics.domain = event.domain;
  if (event.name.startsWith("semantic_recovery_") && !["semantic_recovery_attempted", "semantic_recovery_ms"].includes(event.name)) {
    diagnostics.semantic_recovery_outcome = event.name.replace("semantic_recovery_", "");
  }
  if (event.interactionKind) diagnostics.interaction_kind = event.interactionKind;
  if (event.targetKind) diagnostics.target_kind = event.targetKind;
  if (event.targetId ?? event.targetProject) diagnostics.target_id = event.targetId ?? event.targetProject!;
  if (event.confidence !== undefined) diagnostics.semantic_recovery_confidence = event.confidence;
  if (event.supportStatus) diagnostics.support_status = event.supportStatus;
  if (event.verificationMethod) diagnostics.verification_method = event.verificationMethod;
  if (event.visualKind) diagnostics.visual_kind = event.visualKind;
  if (event.presentation) diagnostics.presentation = event.presentation;
  if (event.rendererFallbackStage) diagnostics.renderer_fallback_stage = event.rendererFallbackStage;
  if (event.validationFailure) diagnostics.semantic_recovery_validation_failure = event.validationFailure;
}

/** Never let analytics delay or fail the visitor-facing response. */
function scheduleAnalytics(event: TurnAnalytics): void {
  const task = captureTurnAnalytics(event);
  if (process.env.VERCEL) {
    waitUntil(task);
    return;
  }
  void task;
}

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  let env: EnvConfig;
  try {
    env = readEnv();
  } catch (error) {
    return chatErrorResponse(error, requestId);
  }
  if (env.features.evidencePipeline.kind === "disabled") {
    return fail(VERIFICATION_UNAVAILABLE_MESSAGE, 503);
  }
  const rate = await getRateLimiter(env).check(clientKey(request));
  if (!rate.ok) {
    const retryAfter = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
    return new Response("You're sending messages faster than I can keep up with. Try again shortly.", {
      status: 429,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": String(retryAfter) },
    });
  }

  let parsed: z.infer<typeof requestSchema>;
  try {
    parsed = requestSchema.parse(await request.json());
  } catch (error) {
    return fail(error instanceof z.ZodError ? "Malformed chat request." : "Malformed request body.", 400);
  }
  // Only conversational text crosses the model boundary. Client-supplied
  // assistant data parts (citations, visuals, status) are never re-trusted.
  const messages: CounterpartMessage[] = parsed.messages.map((message, index) => ({
    id: message.id ?? `request-message-${index}`,
    role: message.role,
    parts: message.parts.flatMap((part) =>
      part.type === "text" && part.text ? [{ type: "text" as const, text: part.text }] : [],
    ),
  }));
  const latestIndex = messages.findLastIndex((message) => message.role === "user");
  const latest = textOf(messages[latestIndex]);
  if (!latest) return fail("The latest user message is empty.", 400);
  if (latest.length > env.limits.maxMessageChars) {
    return fail(`That message exceeds the ${env.limits.maxMessageChars}-character limit.`, 413);
  }

  try {
    const profile = loadProfile();
    const projects = loadProjects();
    // Validate index before committing HTTP headers. Later provider failures
    // are stream errors, with no answer/citations or factual insufficiency status.
    const retriever = getRetriever();
    const stream = createUIMessageStream<CounterpartMessage>({
      execute: async ({ writer }) => {
        const diagnostics: Record<string, string | number> = {
          build_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
          pipeline_version: RELIABILITY_VERSIONS.pipeline,
          resolver_version: RELIABILITY_VERSIONS.resolver,
        };
        try {
          const result = await traced(
            env,
            TRACE_NAMES.request,
            { request_id: requestId },
            async (span) => {
              const outcome = await answerPortfolioQuestion({
                question: latest,
                history: messages.slice(0, latestIndex),
                profile,
                projects,
                env,
                retriever,
                requestId,
                abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(85_000)]),
                onProgress: (stage) => {
                  if (stage !== "done") writeStatus(writer, { stage });
                },
                onVerificationEvent:
                  process.env.NODE_ENV === "development"
                    ? (event) => {
                        recordDiagnostic(diagnostics, event);
                      }
                    : undefined,
              });
              span?.setAttribute("route", outcome.kind);
              if (outcome.kind === "answer") span?.setAttribute("support_status", outcome.answer.support);
              return outcome;
            },
          );

          if (result.kind === "local") {
            writeText(writer, result.text);
            writeStatus(writer, { stage: "local" });
            scheduleAnalytics({
              requestId,
              route: "local",
              interpretation: structuredInterpretationAnalytics(result.understoodQuery),
              visualKind: null,
            });
            if (process.env.NODE_ENV === "development") {
              console.info("[chat] pipeline diagnostics", {
                request_id: requestId,
                ...diagnostics,
                route: "local",
              });
            }
            return;
          }

          writeText(writer, result.answer.text);
          if (result.answer.visual) {
            writer.write({ type: "data-visual", id: "visual", data: result.answer.visual });
          }
          writer.write({ type: "data-sources", id: "sources", data: result.answer.citations });
          writer.write({ type: "data-followups", id: "followups", data: result.answer.followUps });
          writeStatus(writer, { stage: "done", support: result.answer.support });
          scheduleAnalytics({
            requestId,
            route: "answer",
            interpretation: structuredInterpretationAnalytics(result.answer.understoodQuery),
            visualKind: result.answer.visual?.kind ?? null,
            support: result.answer.support,
            rendering: result.answer.rendering,
            citationCount: result.answer.citations.length,
            followUpCount: result.answer.followUps.length,
          });
          if (process.env.NODE_ENV === "development") {
            console.info("[chat] pipeline diagnostics", {
              request_id: requestId,
              ...diagnostics,
              route: "answer",
            });
          }
        } catch (error) {
          // Reuse sanitized internal logging; HTTP status cannot change midstream.
          chatErrorResponse(error, requestId, env);
          writeStatus(writer, { stage: "error" });
          throw error;
        }
      },
      onError: publicChatErrorMessage,
    });
    return createUIMessageStreamResponse({ stream });
  } catch (error) {
    return chatErrorResponse(error, requestId, env);
  }
}
