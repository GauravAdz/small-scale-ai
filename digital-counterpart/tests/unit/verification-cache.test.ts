import { describe, expect, it, vi } from "vitest";
import { readEnv } from "@/lib/config";
import { CachedEvidenceVerifier, verificationCacheKey } from "@/lib/evidence/cached-verifier";
import { InMemoryVerificationCache, type VerificationCache } from "@/lib/evidence/verification-cache";
import type { SupportAssessment } from "@/lib/evidence/support";
import type { EvidenceRecord } from "@/lib/evidence/types";
import type { ComplexEvidenceVerifier } from "@/lib/evidence/verifier";
import { EvidenceVerificationError, ProviderUnavailableError, VerificationBudgetExceededError } from "@/lib/errors";

const evidence: EvidenceRecord = { id: "e1", docId: "d1", kind: "fact", authority: "profile", text: "Gaurav built a robot.", locator: { source: "data/profile.json" }, sourceHash: "a".repeat(64) };
const input = { question: { id: "q1", text: "What did Gaurav build?", kind: "unknown" as const }, candidateEvidence: [evidence] };
const result: SupportAssessment = { questionId: "q1", question: input.question.text, status: "supported", claims: [{ id: "c1", text: evidence.text, kind: "fact", evidenceIds: ["e1"] }], evidenceIds: ["e1"], method: "model" };
const config = () => readEnv({ NODE_ENV: "test" });
const makeCache = () => new InMemoryVerificationCache({ ttlMs: 1000, maxEntries: 10 });
const setup = (verify = vi.fn<ComplexEvidenceVerifier["verify"]>().mockResolvedValue(result), cache: VerificationCache = makeCache()) => {
  const options = { verifier: { verify }, cache, env: config(), indexDigest: "index-a", observe: vi.fn() };
  return { options, verify, verifier: new CachedEvidenceVerifier(options) };
};

describe("validated verification caching", () => {
  it("hits across whitespace/case and clause positions, with current claim IDs", async () => {
    const { verifier, verify } = setup();
    await verifier.verify(input);
    const cached = await verifier.verify({ ...input, question: { ...input.question, id: "q2", text: " WHAT did  Gaurav build? " } });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(cached.questionId).toBe("q2");
    expect(cached.claims[0].id).toBe("q2:model:0");
  });

  it("caches instruction-boundary decisions without turning them into claims", async () => {
    const boundary: SupportAssessment = {
      questionId: "q1",
      question: input.question.text,
      status: "insufficient",
      claims: [],
      evidenceIds: [],
      method: "model",
      responseMode: "instruction-boundary",
    };
    const { verifier, verify } = setup(
      vi.fn<ComplexEvidenceVerifier["verify"]>().mockResolvedValue(boundary),
    );
    await verifier.verify(input);
    const cached = await verifier.verify({
      ...input,
      question: { ...input.question, id: "q2", text: " WHAT did  Gaurav build? " },
    });
    expect(cached).toMatchObject({
      questionId: "q2",
      responseMode: "instruction-boundary",
      claims: [],
      evidenceIds: [],
    });
    expect(verify).toHaveBeenCalledOnce();
  });

  it.each(["indexDigest", "verifierProvider", "verifierModel", "verifierPromptVersion", "verificationPolicyVersion", "contextDigest"] as const)("changes the key for %s", (field) => {
    const key = { question: "Question?", indexDigest: "index", verifierProvider: "p", verifierModel: "m", verifierPromptVersion: "prompt", verificationPolicyVersion: "policy", contextDigest: "context" };
    expect(verificationCacheKey({ ...key, [field]: "changed" })).not.toBe(verificationCacheKey(key));
  });

  it("calls the verifier again for a changed index, model, or evidence context", async () => {
    const { verifier, verify, options } = setup();
    await verifier.verify(input);
    await new CachedEvidenceVerifier({ ...options, indexDigest: "index-b" }).verify(input);
    const changed = config();
    changed.models.verifier = { ...changed.models.verifier, model: "another-model" };
    await new CachedEvidenceVerifier({ ...options, env: changed }).verify(input);
    await verifier.verify({ ...input, candidateEvidence: [{ ...evidence, text: "Changed evidence." }] });
    expect(verify).toHaveBeenCalledTimes(4);
  });

  it.each([new ProviderUnavailableError("rate limited", { code: "http_429" }), new Error("timeout"), new EvidenceVerificationError("malformed JSON")])("never caches a failed call: %s", async (error) => {
    const { verifier, verify } = setup(vi.fn<ComplexEvidenceVerifier["verify"]>().mockRejectedValue(error));
    await expect(verifier.verify(input)).rejects.toBe(error);
    await expect(verifier.verify(input)).rejects.toBe(error);
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ...result, status: "unsupported" },
    { ...result, question: "Wrong question" },
    { ...result, claims: [] },
    { ...result, evidenceIds: ["unknown"] },
    { ...result, claims: [{ ...result.claims[0], evidenceIds: ["unknown"] }] },
    { ...result, claims: [{ ...result.claims[0], kind: "inference" }] },
    { ...result, status: "insufficient" },
  ])("rejects invalid model output without caching", async (invalid) => {
    const { verifier, verify } = setup(vi.fn<ComplexEvidenceVerifier["verify"]>().mockResolvedValue(invalid as SupportAssessment));
    await expect(verifier.verify(input)).rejects.toBeInstanceOf(EvidenceVerificationError);
    await expect(verifier.verify(input)).rejects.toBeInstanceOf(EvidenceVerificationError);
    expect(verify).toHaveBeenCalledTimes(2);
  });

  it.each(["supported", "partially-supported", "contradicted", "insufficient"] as const)("caches valid %s assessments", async (status) => {
    const assessment = status === "insufficient" ? { ...result, status, claims: [], evidenceIds: [] } : { ...result, status };
    const { verifier, verify } = setup(vi.fn<ComplexEvidenceVerifier["verify"]>().mockResolvedValue(assessment));
    await verifier.verify(input);
    expect((await verifier.verify(input)).status).toBe(status);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("locally rejects corrupt cache entries then re-verifies", async () => {
    const cache = { get: vi.fn().mockResolvedValue({ ...result, evidenceIds: ["unknown"] }), set: vi.fn() };
    const { verifier, verify, options } = setup(undefined, cache);
    expect((await verifier.verify(input)).status).toBe("supported");
    expect(verify).toHaveBeenCalledOnce();
    expect(options.observe).toHaveBeenCalledWith({ name: "verification_cache_invalid" });
  });

  it("enforces one turn budget across concurrent calls", async () => {
    const { verify, options } = setup();
    const verifier = new CachedEvidenceVerifier({ ...options, cache: undefined });
    const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => verifier.verify(input)));
    expect(verify).toHaveBeenCalledTimes(3);
    expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(2);
    await expect(verifier.verify(input)).rejects.toBeInstanceOf(VerificationBudgetExceededError);
  });

  it("expires entries, evicts the least recently used, and isolates mutation", async () => {
    let now = 0;
    const cache = new InMemoryVerificationCache({ ttlMs: 100, maxEntries: 2 }, () => now);
    await cache.set("a", result);
    await cache.set("b", result);
    const a = (await cache.get("a"))!;
    a.claims[0].text = "mutated";
    await cache.set("c", result);
    expect(await cache.get("b")).toBeNull();
    expect((await cache.get("a"))?.claims[0].text).toBe(evidence.text);
    now = 100;
    expect(await cache.get("a")).toBeNull();
  });
});
