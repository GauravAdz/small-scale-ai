import { describe, expect, it, vi } from "vitest";
import { readEnv } from "@/lib/config";
import type { FactualAnswerPlan } from "@/lib/llm/answer-plan";
import { MemoryAnswerCache } from "@/lib/llm/answer-cache";
import { naturalAnswerKey, naturalAnswerPlan, voiceInput, validateRewrite, reviewEffort, type NaturalAnswerModel, type VoiceInput } from "@/lib/llm/natural-answer";

const env = readEnv({ NODE_ENV: "test", LLM_RENDERER_PROVIDER: "openai", LLM_RENDERER_MODEL: "gpt-5.6-luna", OPENAI_API_KEY: "test-secret" });
const plan: FactualAnswerPlan = { clauses: [{ questionId: "q1", status: "supported", claims: [
  { id: "q1:fact", kind: "fact", text: "Gaurav's profile records his location as Linz, Austria.", evidenceIds: ["profile:bio"] },
] }] };
function model(): NaturalAnswerModel {
  return {
    rewrite: vi.fn(async (input: VoiceInput) => ({ segments: input.map(({ id }) => ({ id, text: "Gaurav is based in Linz, Austria." })) })),
    review: vi.fn(async (input: VoiceInput) => ({ checks: input.map(({ id }) => ({ id, equivalent: true })) })),
  };
}
const cache = () => new MemoryAnswerCache({ ttlMs: 86_400_000, maxEntries: 10 });

describe("checked natural answers", () => {
  it("preserves proficiency labels and spends more review reasoning on inferences", () => {
    const input = voiceInput(plan);
    input[0].text = "Gaurav's profile lists Pandas at Experienced level.";
    expect(() => validateRewrite(input, { segments: [{ id: "0:0", text: "Gaurav has experience with Pandas." }] })).toThrow(/skill level/);
    expect(() => validateRewrite(input, { segments: [{ id: "0:0", text: "Gaurav is experienced with Pandas." }] })).not.toThrow();
    expect(reviewEffort(input)).toBe("low");
    expect(reviewEffort([...input, ...input])).toBe("medium");
    input[0].kind = "inference";
    expect(reviewEffort(input)).toBe("medium");
  });
  it("reuses a paraphrase across visitors and clause IDs while rebinding citations", async () => {
    const ai = model(); const shared = cache();
    const options = { env, indexDigest: "corpus-v1", cache: shared, model: ai };
    const first = await naturalAnswerPlan(plan, options);
    const secondPlan = structuredClone(plan);
    secondPlan.clauses[0].questionId = "q-other";
    secondPlan.clauses[0].claims[0].id = "q-other:fact";
    const second = await naturalAnswerPlan(secondPlan, options);
    expect(second.clauses[0].claims[0]).toMatchObject({ id: "q-other:fact", text: "Gaurav is based in Linz, Austria.", evidenceIds: ["profile:bio"] });
    expect(first.clauses[0].claims[0].id).toBe("q1:fact");
    expect(ai.rewrite).toHaveBeenCalledOnce(); expect(ai.review).toHaveBeenCalledOnce();
    expect(plan.clauses[0].claims[0].text).toContain("profile records");
  });
  it("invalidates on facts, support status, evidence, source digest and model changes", () => {
    const key = naturalAnswerKey(plan, env, "v1");
    for (const change of [
      (p: FactualAnswerPlan) => { p.clauses[0].claims[0].text = "Gaurav is based in Vienna."; },
      (p: FactualAnswerPlan) => { p.clauses[0].status = "contradicted"; },
      (p: FactualAnswerPlan) => { p.clauses[0].claims[0].evidenceIds = ["other"]; },
    ]) { const changed = structuredClone(plan); change(changed); expect(naturalAnswerKey(changed, env, "v1")).not.toBe(key); }
    expect(naturalAnswerKey(plan, env, "v2")).not.toBe(key);
    expect(naturalAnswerKey(plan, { ...env, models: { ...env.models, renderer: { ...env.models.renderer, model: "other" } } }, "v1")).not.toBe(key);
  });
  it("rejects additions without an interactive correction retry or caching bad wording", async () => {
    const ai = model(); const shared = cache();
    vi.mocked(ai.rewrite).mockResolvedValue({ segments: [{ id: "0:0", text: "Gaurav lives in Linz and is a senior engineer." }] });
    vi.mocked(ai.review).mockResolvedValue({ checks: [{ id: "0:0", equivalent: false }] });
    const options = { env, indexDigest: "v1", model: ai, cache: shared };
    expect(await naturalAnswerPlan(plan, options)).toBe(plan);
    expect(await naturalAnswerPlan(plan, options)).toBe(plan);
    expect(ai.rewrite).toHaveBeenCalledTimes(2);
  });
  it.each(["validation", "equivalence"] as const)("falls back immediately after a %s rejection", async (issue) => {
    const ai = model(); const shared = cache();
    vi.mocked(ai.rewrite).mockResolvedValue({ segments: [{ id: "0:0", text: issue === "validation"
      ? "Gaurav is based in `Linz`, Austria."
      : "Gaurav is based in Linz and is a senior engineer." }] });
    if (issue === "equivalence") vi.mocked(ai.review).mockResolvedValue({ checks: [{ id: "0:0", equivalent: false }] });
    const options = { env, indexDigest: "v1", model: ai, cache: shared };
    const result = await naturalAnswerPlan(plan, options);
    expect(result).toBe(plan);
    expect(ai.rewrite).toHaveBeenCalledOnce();
    expect(ai.review).toHaveBeenCalledTimes(issue === "validation" ? 0 : 1);
    expect(await naturalAnswerPlan(plan, options)).toBe(plan);
    expect(ai.rewrite).toHaveBeenCalledTimes(2);
    expect(ai.review).toHaveBeenCalledTimes(issue === "validation" ? 0 : 2);
  });
  it("rejects missing/extra/reordered claims and lost numeric facts or inference labels", () => {
    const source = [{ id: "0:0", status: "supported" as const, kind: "inference" as const,
      text: "Based on 6+ years of robotics, Gaurav appears relevant.", evidenceIds: ["e1"] }];
    for (const segments of [[], [{ id: "wrong", text: source[0].text }],
      [{ id: "0:0", text: "Based on 10 years of robotics, Gaurav appears relevant." }],
      [{ id: "0:0", text: "Gaurav is qualified due to 6+ years of robotics." }],
    ]) expect(() => validateRewrite(source, { segments })).toThrow();
  });
  it("does not accept a reviewer that omits a verdict", async () => {
    const ai = model(); vi.mocked(ai.review).mockResolvedValue({ checks: [] });
    expect(await naturalAnswerPlan(plan, { env, indexDigest: "v1", model: ai })).toBe(plan);
  });
  it("coalesces simultaneous requests without one visitor cancelling another", async () => {
    const ai = model(); const shared = cache(); let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(ai.rewrite).mockImplementation(async (input) => {
      await gate; return { segments: input.map(({ id }) => ({ id, text: "Gaurav is based in Linz, Austria." })) };
    });
    const controller = new AbortController();
    const options = { env, indexDigest: "v1", model: ai, cache: shared };
    const first = naturalAnswerPlan(plan, { ...options, abortSignal: controller.signal });
    const second = naturalAnswerPlan(plan, options);
    const rejected = expect(first).rejects.toThrow();
    controller.abort(); release();
    await rejected;
    expect((await second).clauses[0].claims[0].text).toBe("Gaurav is based in Linz, Austria.");
    expect(ai.rewrite).toHaveBeenCalledOnce();
  });
  it("falls back on a provider error and does not make a review call", async () => {
    const ai = model(); vi.mocked(ai.rewrite).mockRejectedValue(new Error("provider error"));
    const observe = vi.fn();
    expect(await naturalAnswerPlan(plan, { env, indexDigest: "v1", model: ai, observe })).toBe(plan);
    expect(ai.review).not.toHaveBeenCalled();
    expect(observe).toHaveBeenCalledWith({ name: "renderer_fallback", rendererFallbackStage: "rewrite" });
  });
  it("bounds an unresponsive model and does not cache a timeout", async () => {
    vi.useFakeTimers();
    try {
      const ai = model();
      vi.mocked(ai.rewrite).mockImplementation(() => new Promise(() => {}));
      const store = { get: vi.fn(async () => undefined), set: vi.fn() };
      // AbortSignal.timeout uses native timers, so inject its signal for this test.
      const controller = new AbortController();
      const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
      try {
        const pending = naturalAnswerPlan(plan, { env, indexDigest: "v1", cache: store, model: ai });
        await vi.advanceTimersByTimeAsync(1);
        controller.abort(new Error("Timed out"));
        expect(await pending).toBe(plan);
        expect(ai.review).not.toHaveBeenCalled();
        expect(store.set).not.toHaveBeenCalled();
      } finally { timeout.mockRestore(); }
    } finally { vi.useRealTimers(); }
  });
  it.each(["expired", "wrong-key", "malformed"])("regenerates a %s cache entry", async (fault) => {
    const ai = model();
    const key = naturalAnswerKey(plan, env, "v1");
    const store = { get: vi.fn(async () => ({
      key: fault === "wrong-key" ? "another-plan" : key,
      expiresAt: fault === "expired" ? 0 : Date.now() + 10_000,
      rewrite: { segments: [{ id: fault === "malformed" ? "wrong" : "0:0", text: "Stale cached wording." }] },
    })), set: vi.fn(async () => {}) };
    const result = await naturalAnswerPlan(plan, { env, indexDigest: "v1", cache: store, model: ai });
    expect(result.clauses[0].claims[0].text).toBe("Gaurav is based in Linz, Austria.");
    expect(ai.review).toHaveBeenCalledOnce();
    expect(store.set).toHaveBeenCalledOnce();
  });
  it("keeps empty plans free", async () => {
    const ai = model();
    const empty = { clauses: [] };
    expect(await naturalAnswerPlan(empty, { env, indexDigest: "v1", model: ai })).toBe(empty);
    expect(ai.rewrite).not.toHaveBeenCalled();
  });
  it("keeps disabled rendering free and omits incidental IDs from model input", async () => {
    const ai = model();
    expect(await naturalAnswerPlan(plan, { env: { ...env, naturalAnswers: { ...env.naturalAnswers, enabled: false } }, indexDigest: "v1", model: ai })).toBe(plan);
    expect(ai.rewrite).not.toHaveBeenCalled();
    expect(JSON.stringify(voiceInput(plan))).not.toContain("q1");
  });
});

describe("bounded answer cache", () => {
  it("expires entries, evicts the least recently used, and prevents caller mutation", async () => {
    let now = 100;
    const store = new MemoryAnswerCache({ ttlMs: 10, maxEntries: 2 }, () => now);
    await store.set("a", { text: "A" }); await store.set("b", "B");
    (await store.get("a") as { text: string }).text = "changed";
    await store.set("c", "C");
    expect(await store.get("b")).toBeUndefined();
    expect(await store.get("a")).toEqual({ text: "A" });
    now = 110; expect(await store.get("a")).toBeUndefined();
  });
});
