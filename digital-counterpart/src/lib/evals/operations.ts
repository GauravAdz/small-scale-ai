import type { VerificationEvent, VerificationObserver } from "@/lib/observability/verification";

export type OperationalTurn = { events: VerificationEvent[]; failed: boolean };
export function recordOperations(): { turn: OperationalTurn; observe: VerificationObserver } {
  const turn: OperationalTurn = { events: [], failed: false };
  return { turn, observe: (event) => turn.events.push(event) };
}

export function operationalMetrics(turns: readonly OperationalTurn[], pricing?: {
  inputPerMillion: number; outputPerMillion: number; cachedInputPerMillion?: number;
}) {
  const events = turns.flatMap(({ events }) => events);
  const values = (name: VerificationEvent["name"]) => events.filter((event) => event.name === name).map((event) => event.value ?? 1);
  const sum = (name: VerificationEvent["name"]) => values(name).reduce((total, value) => total + value, 0);
  const roleSum = (name: "input_tokens" | "output_tokens", role: NonNullable<VerificationEvent["modelRole"]>) =>
    events.filter((event) => event.name === name && (event.modelRole ?? "verifier") === role)
      .reduce((total, event) => total + (event.value ?? 0), 0);
  const ratio = (a: number, b: number) => b ? a / b : 0;
  const percentile = (values: number[], p: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
  };
  const hits = sum("verification_cache_hit");
  const misses = sum("verification_cache_miss");
  const semanticRecoveryCalls = sum("semantic_recovery_attempted");
  const calls = semanticRecoveryCalls + sum("verification_llm") + sum("renderer_llm") + sum("renderer_review_llm");
  const has = (turn: OperationalTurn, name: VerificationEvent["name"]) => turn.events.some((event) => event.name === name);
  const tokenUsageKnown = values("input_tokens").length === calls && values("output_tokens").length === calls;
  const cost = pricing && tokenUsageKnown ? (
    Math.max(0, sum("input_tokens") - sum("cached_input_tokens")) * pricing.inputPerMillion +
    sum("cached_input_tokens") * (pricing.cachedInputPerMillion ?? pricing.inputPerMillion) +
    sum("output_tokens") * pricing.outputPerMillion
  ) / 1_000_000 : null;
  return {
    turns: turns.length,
    failedTurns: turns.filter(({ failed }) => failed).length,
    deterministicRequestPercent: 100 * ratio(turns.filter((turn) => !turn.failed && has(turn, "verification_deterministic") && !has(turn, "semantic_recovery_attempted") && !has(turn, "verification_llm") && !has(turn, "verification_cache_hit") && !has(turn, "renderer_llm") && !has(turn, "renderer_review_llm") && !has(turn, "renderer_cache_hit") && !has(turn, "renderer_coalesced")).length, turns.length),
    llmRequestPercent: 100 * ratio(turns.filter((turn) => has(turn, "semantic_recovery_attempted") || has(turn, "verification_llm") || has(turn, "renderer_llm") || has(turn, "renderer_review_llm")).length, turns.length),
    cacheHitPercent: 100 * ratio(hits, hits + misses),
    cacheHits: hits,
    modelCalls: calls,
    semanticRecoveryCalls,
    semanticRecoveryRatePercent: 100 * ratio(semanticRecoveryCalls, turns.length),
    writerCalls: sum("renderer_llm"),
    voiceReviewCalls: sum("renderer_review_llm"),
    answerCacheHits: sum("renderer_cache_hit"),
    coalescedAnswers: sum("renderer_coalesced"),
    naturalAnswerFallbacks: sum("renderer_fallback"),
    rendererAttemptCount: sum("renderer_attempt_count"),
    medianRequestTotalMs: percentile(values("request_total_ms"), 0.5),
    p95RequestTotalMs: percentile(values("request_total_ms"), 0.95),
    medianResolutionMs: percentile(values("resolution_ms"), 0.5),
    p95ResolutionMs: percentile(values("resolution_ms"), 0.95),
    medianInterpretationMs: percentile(values("interpretation_ms"), 0.5),
    p95InterpretationMs: percentile(values("interpretation_ms"), 0.95),
    medianSemanticRecoveryMs: percentile(values("semantic_recovery_ms"), 0.5),
    p95SemanticRecoveryMs: percentile(values("semantic_recovery_ms"), 0.95),
    medianRetrievalMs: percentile(values("retrieval_ms"), 0.5),
    p95RetrievalMs: percentile(values("retrieval_ms"), 0.95),
    medianVerificationStageMs: percentile(values("verification_ms"), 0.5),
    p95VerificationStageMs: percentile(values("verification_ms"), 0.95),
    medianPlanningMs: percentile(values("planning_ms"), 0.5),
    p95PlanningMs: percentile(values("planning_ms"), 0.95),
    medianRenderingStageMs: percentile(values("rendering_ms"), 0.5),
    p95RenderingStageMs: percentile(values("rendering_ms"), 0.95),
    medianRendererLatencyMs: percentile(values("renderer_latency_ms"), 0.5),
    averageModelCallsPerTurn: ratio(calls, turns.length),
    medianVerifierLatencyMs: percentile(values("verification_latency_ms"), 0.5),
    p95VerifierLatencyMs: percentile(values("verification_latency_ms"), 0.95),
    medianLlmLatencyMs: percentile(values("llm_latency_ms"), 0.5),
    p95LlmLatencyMs: percentile(values("llm_latency_ms"), 0.95),
    averageInputTokens: tokenUsageKnown ? ratio(sum("input_tokens"), calls) : null,
    averageOutputTokens: tokenUsageKnown ? ratio(sum("output_tokens"), calls) : null,
    cachedInputTokens: sum("cached_input_tokens"),
    interpreterInputTokens: roleSum("input_tokens", "interpreter"),
    interpreterOutputTokens: roleSum("output_tokens", "interpreter"),
    verifierInputTokens: roleSum("input_tokens", "verifier"),
    verifierOutputTokens: roleSum("output_tokens", "verifier"),
    rendererInputTokens: roleSum("input_tokens", "renderer"),
    rendererOutputTokens: roleSum("output_tokens", "renderer"),
    reviewerInputTokens: roleSum("input_tokens", "reviewer"),
    reviewerOutputTokens: roleSum("output_tokens", "reviewer"),
    estimatedCostPer100Questions: cost === null ? null : ratio(cost * 100, turns.length),
  };
}
