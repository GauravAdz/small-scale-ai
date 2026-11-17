import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";

import type { EnvConfig } from "@/lib/config";

export const TRACE_NAMES = {
  request: "counterpart.request",
  resolution: "counterpart.question_resolution",
  interpretation: "counterpart.query_interpretation",
  retrieval: "counterpart.retrieval",
  reranking: "counterpart.reranking",
  verification: "counterpart.support_verification",
  planning: "counterpart.factual_planning",
  rendering: "counterpart.rendering",
  citations: "counterpart.citations",
} as const;

export async function traced<T>(
  config: EnvConfig,
  name: (typeof TRACE_NAMES)[keyof typeof TRACE_NAMES],
  attributes: Attributes,
  operation: (span?: Span) => Promise<T> | T,
): Promise<T> {
  if (config.features.observability.kind === "disabled") return operation();
  return trace.getTracer("digital-counterpart", "2").startActiveSpan(name, { attributes }, async (span) => {
    const started = Date.now();
    try {
      const result = await operation(span);
      span.setAttribute("latency_ms", Date.now() - started);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      // Provider Error objects can contain request headers and serialized prompts.
      span.recordException({ name: error instanceof Error ? error.name : "UnknownError", message: "Operation failed" });
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function aiTelemetry(config: EnvConfig, functionId: string) {
  return {
    isEnabled: config.features.observability.kind === "enabled",
    recordInputs: false,
    recordOutputs: false,
    functionId,
  } as const;
}
