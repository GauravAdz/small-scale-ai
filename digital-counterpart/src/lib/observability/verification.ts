import { metrics } from "@opentelemetry/api";
import type { EnvConfig } from "@/lib/config";
import { ProviderUnavailableError } from "@/lib/errors";

export type VerificationEvent = {
  name: "verification_cache_hit" | "verification_cache_miss" | "verification_cache_invalid" |
    "verification_cache_error" | "verification_deterministic" | "verification_llm" |
    "verification_llm_success" | "verification_llm_failure" | "verification_latency_ms" |
    "request_total_ms" | "resolution_ms" | "interpretation_ms" | "semantic_recovery_ms" |
    "retrieval_ms" | "verification_ms" | "planning_ms" | "rendering_ms" |
    "llm_latency_ms" | "retrieval_candidate_count" | "verification_evidence_count" |
    "input_tokens" | "output_tokens" | "cached_input_tokens" |
    "renderer_llm" | "renderer_review_llm" | "renderer_cache_hit" | "renderer_cache_miss" |
    "renderer_cache_error" | "renderer_coalesced" | "renderer_fallback" | "renderer_success" |
    "renderer_latency_ms" | "renderer_attempt_count" | "semantic_recovery_attempted" | "semantic_recovery_accepted" |
    "semantic_recovery_ambiguous" | "semantic_recovery_low_confidence" |
    "semantic_recovery_unknown" | "semantic_recovery_invalid" | "semantic_recovery_failed" |
    "pipeline_decision";
  interactionKind?: string;
  targetKind?: string;
  targetId?: string;
  targetProject?: string;
  channel?: string;
  confidence?: number;
  domain?: string;
  supportStatus?: string;
  verificationMethod?: string;
  visualKind?: string;
  presentation?: string;
  modelRole?: "verifier" | "renderer" | "reviewer" | "interpreter";
  value?: number;
  providerErrorType?: string;
  rendererFallbackStage?: "input" | "rewrite" | "validation" | "review" | "equivalence";
  validationFailure?: "schema_parse_failure" | "invalid_intent_target_pair" |
    "unknown_project_slug" | "invalid_channel" | "invalid_aspect" |
    "invalid_confidence" | "other_validation_failure";
};
export type VerificationObserver = (event: VerificationEvent) => void;

export function providerErrorType(error: unknown): string {
  if (error instanceof ProviderUnavailableError) {
    if (error.code === "http_429") return "rate_limit";
    if (error.code === "missing_configuration") return "configuration";
    if (error.code === "TimeoutError" || error.code === "AbortError" || error.code === "http_408") return "timeout";
    return "provider_unavailable";
  }
  return error instanceof Error && error.name === "EvidenceVerificationError" ? "invalid_response" : "internal";
}

/** Explicit allowlist; no prompt text, response bodies, headers, or history. */
export function verificationObserver(config: EnvConfig, observer?: VerificationObserver): VerificationObserver {
  return (event) => {
    observer?.(event);
    if (config.features.observability.kind !== "enabled") return;
    const meter = metrics.getMeter("digital-counterpart", "2");
    const semanticRecovery = event.name.startsWith("semantic_recovery_");
    const role = event.modelRole === "interpreter" || semanticRecovery
      ? config.models.interpreter
      : event.modelRole === "renderer" || event.modelRole === "reviewer"
        ? config.models.renderer
        : config.models.verifier;
    const attributes = {
      provider: role.provider,
      model: role.model,
      ...(event.providerErrorType ? { provider_error_type: event.providerErrorType } : {}),
      ...(event.rendererFallbackStage ? { renderer_fallback_stage: event.rendererFallbackStage } : {}),
      ...(event.validationFailure ? { validation_failure: event.validationFailure } : {}),
      ...(event.interactionKind ? { interaction_kind: event.interactionKind } : {}),
      ...(event.targetKind ? { target_kind: event.targetKind } : {}),
      ...(event.targetId ? { target_id: event.targetId } : {}),
      ...(event.targetProject ? { target_project: event.targetProject } : {}),
      ...(event.channel ? { channel: event.channel } : {}),
      ...(event.confidence !== undefined ? { confidence: event.confidence } : {}),
      ...(event.domain ? { domain: event.domain } : {}),
      ...(event.supportStatus ? { support_status: event.supportStatus } : {}),
      ...(event.verificationMethod ? { verification_method: event.verificationMethod } : {}),
      ...(event.visualKind ? { visual_kind: event.visualKind } : {}),
      ...(event.presentation ? { presentation: event.presentation } : {}),
    };
    if (event.name.endsWith("_ms") || event.name.endsWith("_count") || event.name.endsWith("_tokens")) {
      meter.createHistogram(event.name).record(event.value ?? 0, attributes);
    } else {
      meter.createCounter(event.name).add(event.value ?? 1, attributes);
    }
  };
}
