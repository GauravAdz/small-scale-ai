import { generateText, Output } from "ai";
import { z } from "zod";

import type { EnvConfig } from "@/lib/config";
import { EvidenceVerificationError, ProviderUnavailableError } from "@/lib/errors";
import { getModel, getProviderOptions } from "@/lib/llm/provider";
import { buildVerifierSystemPrompt } from "@/lib/llm/prompt";
import { aiTelemetry } from "@/lib/observability/tracing";
import type { AtomicQuestion } from "./question";
import { type SupportAssessment } from "./support";
import type { EvidenceRecord } from "./types";
import type { ComplexEvidenceVerifier } from "./verifier";
import { validateModelAssessment } from "./validation";
import type { VerificationObserver } from "@/lib/observability/verification";

function modelAssessmentSchema(candidateEvidenceIds: readonly string[]) {
  const [firstId, ...remainingIds] = [...new Set(candidateEvidenceIds)];
  if (!firstId) {
    throw new EvidenceVerificationError("Model verification requires candidate evidence.");
  }

  // Put the exact request-scoped IDs in the provider's JSON Schema. Structured
  // output can then select evidence, but cannot invent, mistype, or cite an ID
  // from a record that was not supplied for this proposition.
  const evidenceIdSchema = z.enum([firstId, ...remainingIds]);
  return z.object({
    answerType: z.enum(["portfolio-evidence", "instruction-boundary"]),
    status: z.enum(["supported", "partially-supported", "contradicted", "insufficient"]),
    claims: z.array(
      z.object({
        proposition: z.string().min(1),
        kind: z.enum(["fact", "authored-opinion", "inference"]),
        evidenceIds: z.array(evidenceIdSchema).min(1),
      }),
    ),
    // OpenAI strict structured outputs require every property in `required`.
    // Represent an absent reason as null on the wire, then normalize internally.
    reason: z.string().min(1).nullable(),
  });
}

type ModelAssessment = z.infer<ReturnType<typeof modelAssessmentSchema>>;

function safeProviderFailure(
  role: EnvConfig["models"]["verifier"],
  error: unknown,
): ProviderUnavailableError {
  const outer = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const failure = outer.lastError && typeof outer.lastError === "object"
    ? outer.lastError as Record<string, unknown>
    : outer;
  const headers = failure.responseHeaders && typeof failure.responseHeaders === "object"
    ? failure.responseHeaders as Record<string, unknown>
    : {};
  const statusCode = typeof failure.statusCode === "number" ? failure.statusCode : undefined;
  const code =
    typeof failure.code === "string"
      ? failure.code
      : statusCode
        ? `http_${statusCode}`
        : error instanceof Error
          ? error.name
          : "unknown_provider_error";
  const requestId = ["x-request-id", "apim-request-id", "x-ms-request-id"]
    .map((name) => headers[name])
    .find((value): value is string => typeof value === "string" && value.length > 0);
  const retryable =
    typeof failure.isRetryable === "boolean"
      ? failure.isRetryable
      : statusCode === undefined || statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500;

  return new ProviderUnavailableError(
    "The evidence verifier provider request failed.",
    {
      provider: role.provider,
      model: role.model,
      code,
      requestId,
      retryable,
      upstreamErrorClass: error instanceof Error ? error.name : undefined,
    },
    { cause: error },
  );
}

/** A constrained Level-3 verifier. It is never used as a permissive fallback. */
export class AiSdkEvidenceVerifier implements ComplexEvidenceVerifier {
  constructor(
    private readonly config: EnvConfig,
    private readonly observe?: VerificationObserver,
    private readonly abortSignal?: AbortSignal,
  ) {}

  async verify(input: {
    question: AtomicQuestion;
    candidateEvidence: readonly EvidenceRecord[];
  }): Promise<SupportAssessment> {
    const role = this.config.models.verifier;
    if (!role.apiKey) {
      throw new ProviderUnavailableError(
        `No credential is configured for verifier ${role.provider}.`,
        {
          provider: role.provider,
          model: role.model,
          code: "missing_configuration",
          retryable: false,
        },
      );
    }

    const payload = {
      untrustedVisitorQuestion: {
        id: input.question.id,
        text: input.question.text,
        kind: input.question.kind,
      },
      untrustedPortfolioRecords: input.candidateEvidence.map((record) => ({
        evidenceId: record.id,
        authority: record.authority,
        kind: record.kind,
        source: record.locator.source,
        headingPath: record.locator.headingPath,
        text: record.text,
      })),
    };

    const assessmentSchema = modelAssessmentSchema(
      input.candidateEvidence.map(({ id }) => id),
    );
    let assessment: ModelAssessment;
    try {
      const result = await generateText({
        model: getModel(role),
        output: Output.object({
          name: "evidence_support_assessment",
          schema: assessmentSchema,
        }),
        system: buildVerifierSystemPrompt(),
        // All visitor and retrieved text remains serialized in the user role.
        // Field names make the trust boundary explicit without relying on
        // delimiters that hostile content could imitate.
        prompt: JSON.stringify(payload),
        // Interpretation may need an identity inference plus separately cited
        // facts for two alternatives. Leave room for structured output and reasoning.
        maxOutputTokens: 1600,
        // SDK retries are provider calls too. A visitor turn has one central budget.
        maxRetries: 0,
        abortSignal: this.abortSignal
          ? AbortSignal.any([this.abortSignal, AbortSignal.timeout(this.config.verificationBudget.timeoutMs)])
          : AbortSignal.timeout(this.config.verificationBudget.timeoutMs),
        providerOptions: getProviderOptions(role),
        telemetry: aiTelemetry(this.config, "counterpart.support_verifier"),
      });
      if (result.usage.inputTokens !== undefined) this.observe?.({ name: "input_tokens", value: result.usage.inputTokens });
      if (result.usage.outputTokens !== undefined) this.observe?.({ name: "output_tokens", value: result.usage.outputTokens });
      if (result.usage.inputTokenDetails?.cacheReadTokens !== undefined) this.observe?.({ name: "cached_input_tokens", value: result.usage.inputTokenDetails.cacheReadTokens });
      assessment = assessmentSchema.parse(result.output);
    } catch (error) {
      if (error instanceof z.ZodError || (error instanceof Error && /NoObjectGenerated|TypeValidation|JSONParse/.test(error.name))) {
        throw new EvidenceVerificationError("Verifier response could not be parsed or validated.");
      }
      if (error instanceof ProviderUnavailableError) throw error;
      throw safeProviderFailure(role, error);
    }

    if (assessment.answerType === "instruction-boundary") {
      if (assessment.status !== "insufficient" || assessment.claims.length > 0) {
        throw new EvidenceVerificationError("Verifier mixed instruction policy with portfolio claims.");
      }
      return validateModelAssessment({
        questionId: input.question.id,
        question: input.question.text,
        status: "insufficient",
        claims: [],
        evidenceIds: [],
        method: "model",
        responseMode: "instruction-boundary",
      }, input);
    }

    return validateModelAssessment({
      questionId: input.question.id,
      question: input.question.text,
      status: assessment.status,
      claims: assessment.claims.map((claim, index) => ({
        id: `${input.question.id}:model:${index}`,
        // Inference is structured metadata. Make its qualification visible
        // without requiring the model to spell a particular opening phrase.
        // The proposition and evidence links are preserved verbatim.
        text: claim.kind === "inference" && !/^(based on|the evidence suggests|that appears)/i.test(claim.proposition)
          ? `The evidence suggests: ${claim.proposition}`
          : claim.proposition,
        kind: claim.kind,
        evidenceIds: claim.evidenceIds,
      })),
      evidenceIds: [...new Set(assessment.claims.flatMap(({ evidenceIds: ids }) => ids))],
      method: "model",
      reason: assessment.reason ?? undefined,
    }, input);
  }
}
