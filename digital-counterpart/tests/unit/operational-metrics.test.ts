import { describe, expect, it } from "vitest";
import { operationalMetrics, type OperationalTurn } from "@/lib/evals/operations";

describe("operational evaluation", () => {
  it("computes rates, tail latency and usage-based costs without counting cache hits as calls", () => {
    const turns: OperationalTurn[] = [
      { failed: false, events: [{ name: "verification_deterministic" }, { name: "verification_latency_ms", value: 1 }] },
      { failed: false, events: [{ name: "verification_llm" }, { name: "verification_cache_miss" }, { name: "verification_latency_ms", value: 100 }, { name: "input_tokens", value: 1000 }, { name: "cached_input_tokens", value: 200 }, { name: "output_tokens", value: 100 }] },
      { failed: false, events: [{ name: "verification_cache_hit" }, { name: "verification_latency_ms", value: 2 }] },
    ];
    const metrics = operationalMetrics(turns, { inputPerMillion: 1, outputPerMillion: 2, cachedInputPerMillion: 0.1 });
    expect(metrics.cacheHitPercent).toBe(50);
    expect(metrics.modelCalls).toBe(1);
    expect(metrics.medianVerifierLatencyMs).toBe(2);
    expect(metrics.p95VerifierLatencyMs).toBe(100);
    expect(metrics.estimatedCostPer100Questions).toBeCloseTo(0.034);
    expect(operationalMetrics([{ failed: true, events: [{ name: "verification_llm" }] }], { inputPerMillion: 1, outputPerMillion: 2 }).estimatedCostPer100Questions).toBeNull();
  });

  it("counts semantic recovery as a model call and excludes it from deterministic turns", () => {
    const metrics = operationalMetrics([
      {
        failed: false,
        events: [
          { name: "semantic_recovery_attempted" },
          { name: "semantic_recovery_accepted" },
          { name: "input_tokens", value: 80, modelRole: "interpreter" },
          { name: "output_tokens", value: 20, modelRole: "interpreter" },
          { name: "verification_deterministic" },
        ],
      },
    ], { inputPerMillion: 1, outputPerMillion: 2 });
    expect(metrics).toMatchObject({
      semanticRecoveryCalls: 1,
      modelCalls: 1,
      deterministicRequestPercent: 0,
      llmRequestPercent: 100,
      interpreterInputTokens: 80,
      interpreterOutputTokens: 20,
    });
  });

  it("reports request and stage percentiles, renderer attempts and per-role usage", () => {
    const metrics = operationalMetrics([
      {
        failed: false,
        events: [
          { name: "request_total_ms", value: 20 },
          { name: "resolution_ms", value: 2 },
          { name: "interpretation_ms", value: 3 },
          { name: "retrieval_ms", value: 4 },
          { name: "verification_ms", value: 5 },
          { name: "planning_ms", value: 2 },
          { name: "rendering_ms", value: 4 },
          { name: "renderer_llm" },
          { name: "renderer_review_llm" },
          { name: "renderer_attempt_count", value: 1 },
          { name: "input_tokens", value: 60, modelRole: "renderer" },
          { name: "output_tokens", value: 15, modelRole: "renderer" },
          { name: "input_tokens", value: 50, modelRole: "reviewer" },
          { name: "output_tokens", value: 10, modelRole: "reviewer" },
        ],
      },
      {
        failed: false,
        events: [
          { name: "request_total_ms", value: 80 },
          { name: "resolution_ms", value: 7 },
        ],
      },
    ]);
    expect(metrics).toMatchObject({
      medianRequestTotalMs: 20,
      p95RequestTotalMs: 80,
      medianResolutionMs: 2,
      p95ResolutionMs: 7,
      rendererAttemptCount: 1,
      rendererInputTokens: 60,
      rendererOutputTokens: 15,
      reviewerInputTokens: 50,
      reviewerOutputTokens: 10,
    });
  });
});
