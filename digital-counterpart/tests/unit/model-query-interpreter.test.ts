import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";

import { AiSdkSemanticQueryInterpreter } from "@/lib/chat/model-query-interpreter";
import type { SemanticInterpretationInput } from "@/lib/chat/query-understanding";
import { readEnv } from "@/lib/config";
import {
  SemanticRecoveryInvalidError,
  SemanticRecoveryUnavailableError,
} from "@/lib/errors";

vi.mock("ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("ai")>(),
  generateText: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

const config = readEnv({
  NODE_ENV: "test",
  LLM_VERIFIER_PROVIDER: "google",
  LLM_VERIFIER_MODEL: "test-model",
  GOOGLE_GENERATIVE_AI_API_KEY: "test-secret",
});
const input: SemanticInterpretationInput = {
  resolvedQuery: "link ed in pls",
  deterministicIntent: { kind: "unknown", target: { kind: "unknown" } },
  projects: [{ slug: "satellite-classifier", title: "Satellite Classifier" }],
  skillNames: ["JavaScript", "Python"],
};
const valid = {
  canonicalQuery: "What is Gaurav's LinkedIn profile?",
  domain: "portfolio" as const,
  intent: "profile-link",
  targetKind: "profile",
  projectSlug: null,
  channel: "linkedin",
  aspect: "contact",
  confidence: 0.98,
  ambiguous: false,
};

function respond(output: unknown) {
  vi.mocked(generateText).mockResolvedValue({
    output,
    usage: {
      inputTokens: 80,
      outputTokens: 20,
      inputTokenDetails: { cacheReadTokens: 10 },
    },
  } as Awaited<ReturnType<typeof generateText>>);
}

describe("AI SDK semantic query interpreter", () => {
  it("sends only the resolved query and compact allowed ontology", async () => {
    respond(valid);
    const observe = vi.fn();
    expect(await new AiSdkSemanticQueryInterpreter(config, undefined, observe).interpret(input))
      .toEqual(valid);
    const options = vi.mocked(generateText).mock.calls[0][0];
    expect(options).toMatchObject({
      maxRetries: 0,
      maxOutputTokens: 400,
      abortSignal: expect.any(AbortSignal),
    });
    expect(options.system).toContain("Do not answer the question");
    expect(options.system).toContain("Never invent a project");
    const payload = JSON.parse(String(options.prompt));
    expect(payload).toEqual({
      untrustedResolvedQuery: input.resolvedQuery,
      deterministicIntent: { kind: "unknown", targetKind: "unknown" },
      allowedOntology: {
        intents: expect.any(Array),
        channels: ["github", "linkedin", "email", "website", "resume"],
        aspects: expect.any(Array),
        projects: input.projects,
        skillNames: input.skillNames,
        institutions: [],
      },
    });
    expect(String(options.prompt)).not.toMatch(/evidenceId|portfolioRecords|https?:\/\//i);
    expect(observe.mock.calls.map(([event]) => event)).toEqual([
      { name: "input_tokens", value: 80, modelRole: "interpreter" },
      { name: "output_tokens", value: 20, modelRole: "interpreter" },
      { name: "cached_input_tokens", value: 10, modelRole: "interpreter" },
    ]);
  });

  it("uses a strict-compatible schema with nullable optional fields", async () => {
    respond(valid);
    await new AiSdkSemanticQueryInterpreter(config).interpret(input);
    const format = await vi.mocked(generateText).mock.calls[0][0].output!.responseFormat;
    expect(format).toMatchObject({
      type: "json",
      schema: {
        additionalProperties: false,
        required: [
          "canonicalQuery",
          "domain",
          "intent",
          "targetKind",
          "projectSlug",
          "channel",
          "aspect",
          "confidence",
          "ambiguous",
        ],
      },
    });
  });

  it("classifies malformed structured output separately from provider failure", async () => {
    const malformed = new Error("malformed");
    malformed.name = "AI_NoObjectGeneratedError";
    vi.mocked(generateText).mockRejectedValue(malformed);
    await expect(new AiSdkSemanticQueryInterpreter(config).interpret(input))
      .rejects.toBeInstanceOf(SemanticRecoveryInvalidError);

    vi.mocked(generateText).mockRejectedValue({
      statusCode: 429,
      responseBody: "test-secret",
    });
    const error = await new AiSdkSemanticQueryInterpreter(config).interpret(input)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SemanticRecoveryUnavailableError);
    expect(error).toMatchObject({ code: "http_429" });
    expect((error as Error).message).not.toContain("test-secret");
  });

  it("fails locally when no interpreter credential is available", async () => {
    const noCredential = readEnv({ NODE_ENV: "test" });
    await expect(new AiSdkSemanticQueryInterpreter(noCredential).interpret(input))
      .rejects.toMatchObject({ name: "SemanticRecoveryUnavailableError", code: "missing_configuration" });
    expect(generateText).not.toHaveBeenCalled();
  });
});
