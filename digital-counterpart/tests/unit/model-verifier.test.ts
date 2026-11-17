import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import { readEnv } from "@/lib/config";
import { AiSdkEvidenceVerifier } from "@/lib/evidence/model-verifier";
import { EvidenceVerificationError, ProviderUnavailableError } from "@/lib/errors";

vi.mock("ai", async (importOriginal) => ({ ...await importOriginal<typeof import("ai")>(), generateText: vi.fn() }));
afterEach(() => vi.clearAllMocks());
const input = {
  question: { id: "q1", text: "Assess this evidence?", kind: "unknown" as const },
  candidateEvidence: [{ id: "e1", docId: "d1", text: "Recorded fact.", kind: "fact" as const, authority: "profile" as const, locator: { source: "data/profile.json" }, sourceHash: "a".repeat(64) }],
};
const valid = { answerType: "portfolio-evidence", status: "supported", claims: [{ proposition: "Recorded fact.", kind: "fact", evidenceIds: ["e1"] }], reason: null };
const respond = (output: unknown) => vi.mocked(generateText).mockResolvedValue({ output, usage: { inputTokens: 100, outputTokens: 20, inputTokenDetails: { cacheReadTokens: 10 } } } as Awaited<ReturnType<typeof generateText>>);
const config = readEnv({ NODE_ENV: "test", LLM_VERIFIER_PROVIDER: "google", LLM_VERIFIER_MODEL: "test-model", GOOGLE_GENERATIVE_AI_API_KEY: "test-secret" });

describe("paid verifier adapter", () => {
  it("validates evidence and reports provider usage without retries", async () => {
    respond(valid);
    const observe = vi.fn();
    const result = await new AiSdkEvidenceVerifier(config, observe).verify(input);
    expect(result.evidenceIds).toEqual(["e1"]);
    expect(vi.mocked(generateText).mock.calls[0][0]).toMatchObject({ maxRetries: 0, maxOutputTokens: 1600, abortSignal: expect.any(AbortSignal) });
    expect(observe.mock.calls.map(([event]) => event)).toEqual([
      { name: "input_tokens", value: 100 }, { name: "output_tokens", value: 20 }, { name: "cached_input_tokens", value: 10 },
    ]);
  });
  it("sends a strict-compatible schema and normalizes a null reason", async () => {
    respond(valid);
    const result = await new AiSdkEvidenceVerifier(config).verify(input);
    const format = await vi.mocked(generateText).mock.calls[0][0].output!.responseFormat;
    expect(format).toMatchObject({
      type: "json",
      schema: {
        additionalProperties: false,
        required: ["answerType", "status", "claims", "reason"],
        properties: {
          claims: {
            items: {
              properties: {
                evidenceIds: {
                  items: { enum: ["e1"] },
                  minItems: 1,
                },
              },
            },
          },
          reason: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
    });
    expect(result.reason).toBeUndefined();
  });
  it("constrains citations to every supplied candidate ID", async () => {
    const candidateEvidence = [
      ...input.candidateEvidence,
      { ...input.candidateEvidence[0], id: "e2", text: "Another recorded fact." },
    ];
    respond(valid);
    await new AiSdkEvidenceVerifier(config).verify({ ...input, candidateEvidence });
    const format = await vi.mocked(generateText).mock.calls[0][0].output!.responseFormat;
    if (format?.type !== "json") throw new Error("Expected a JSON response format.");
    expect(format.schema.properties.claims.items.properties.evidenceIds.items.enum).toEqual(["e1", "e2"]);
  });
  it("rejects an unknown ID even when a mocked provider bypasses its schema", async () => {
    respond({ ...valid, claims: [{ ...valid.claims[0], evidenceIds: ["fake"] }] });
    await expect(new AiSdkEvidenceVerifier(config).verify(input)).rejects.toBeInstanceOf(EvidenceVerificationError);
  });
  it("preserves a supplied reason", async () => {
    respond({ ...valid, reason: "Directly supported by the record." });
    expect((await new AiSdkEvidenceVerifier(config).verify(input)).reason).toBe("Directly supported by the record.");
  });
  it("keeps visitor and retrieved text inside an explicit untrusted-data envelope", async () => {
    respond(valid);
    await new AiSdkEvidenceVerifier(config).verify(input);
    const options = vi.mocked(generateText).mock.calls[0][0];
    expect(options.system).toContain("retrieved portfolio content");
    expect(options.system).toContain("untrusted data");
    expect(options.system).not.toContain(input.candidateEvidence[0].text);
    expect(JSON.parse(options.prompt as string)).toEqual({
      untrustedVisitorQuestion: input.question,
      untrustedPortfolioRecords: [{
        evidenceId: "e1",
        authority: "profile",
        kind: "fact",
        source: "data/profile.json",
        text: "Recorded fact.",
      }],
    });
  });
  it("returns an instruction-boundary mode without portfolio claims", async () => {
    respond({ answerType: "instruction-boundary", status: "insufficient", claims: [], reason: null });
    expect(await new AiSdkEvidenceVerifier(config).verify(input)).toMatchObject({
      responseMode: "instruction-boundary",
      status: "insufficient",
      claims: [],
      evidenceIds: [],
    });
  });
  it("rejects instruction-boundary output that also evaluates a portfolio claim", async () => {
    respond({ ...valid, answerType: "instruction-boundary" });
    await expect(new AiSdkEvidenceVerifier(config).verify(input)).rejects.toBeInstanceOf(EvidenceVerificationError);
  });
  it.each([
    null,
    { ...valid, status: "invalid" },
    { ...valid, claims: [] },
    { ...valid, claims: [{ ...valid.claims[0], evidenceIds: ["fake"] }] },
    { ...valid, claims: [{ ...valid.claims[0], evidenceIds: [] }] },
    { ...valid, status: "insufficient" },
  ])("rejects invalid structured output", async (output) => {
    respond(output);
    await expect(new AiSdkEvidenceVerifier(config).verify(input)).rejects.toBeInstanceOf(EvidenceVerificationError);
  });
  it("retains explicitly labelled inferences", async () => {
    respond({ ...valid, claims: [{ ...valid.claims[0], kind: "inference", proposition: "Based on the recorded work, this appears relevant." }] });
    expect((await new AiSdkEvidenceVerifier(config).verify(input)).claims[0].kind).toBe("inference");
  });
  it("labels structured inferences without changing the proposition or evidence", async () => {
    const proposition = "Gaurav could plausibly automate irrigation based on his agriculture project.";
    respond({ ...valid, claims: [{ ...valid.claims[0], kind: "inference", proposition }] });
    const claim = (await new AiSdkEvidenceVerifier(config).verify(input)).claims[0];
    expect(claim).toMatchObject({ kind: "inference", text: `The evidence suggests: ${proposition}`, evidenceIds: ["e1"] });
    respond({ ...valid, claims: [{ ...valid.claims[0], kind: "inference", proposition, evidenceIds: ["fake"] }] });
    await expect(new AiSdkEvidenceVerifier(config).verify(input)).rejects.toBeInstanceOf(EvidenceVerificationError);
  });
  it("preserves provider error type without surfacing raw secrets", async () => {
    vi.mocked(generateText).mockRejectedValue({ statusCode: 429, responseBody: "test-secret", responseHeaders: { authorization: "test-secret" } });
    const error = await new AiSdkEvidenceVerifier(config).verify(input).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect(error).toMatchObject({ code: "http_429", retryable: true });
    expect((error as Error).message).not.toContain("test-secret");
  });
});
