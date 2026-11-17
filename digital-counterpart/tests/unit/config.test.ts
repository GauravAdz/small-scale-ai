import { describe, expect, it } from "vitest";

import { assertChatReady, readEnv } from "@/lib/config";
import { ProviderUnavailableError } from "@/lib/errors";

const env = (values: Record<string, string>): NodeJS.ProcessEnv => ({
  NODE_ENV: "test",
  ...values,
});

describe("LLM provider configuration", () => {
  it("reuses the verifier for optional semantic recovery unless given a separate role", () => {
    const shared = readEnv(env({
      LLM_VERIFIER_PROVIDER: "openai",
      LLM_VERIFIER_MODEL: "verifier-model",
      OPENAI_API_KEY: "test-secret",
    }));
    expect(shared.semanticRecovery).toMatchObject({ enabled: true, timeoutMs: 5000 });
    expect(shared.models.interpreter).toEqual(shared.models.verifier);

    const separate = readEnv(env({
      LLM_VERIFIER_PROVIDER: "openai",
      LLM_VERIFIER_MODEL: "verifier-model",
      LLM_INTERPRETER_PROVIDER: "google",
      LLM_INTERPRETER_MODEL: "interpreter-model",
      GOOGLE_GENERATIVE_AI_API_KEY: "interpreter-secret",
    }));
    expect(separate.models.interpreter).toMatchObject({
      provider: "google",
      model: "interpreter-model",
      apiKey: "interpreter-secret",
    });
    expect(readEnv(env({ LLM_INTERPRETER_ENABLED: "false" })).semanticRecovery.enabled).toBe(false);
    expect(() => readEnv(env({ LLM_INTERPRETER_TIMEOUT_MS: "0" }))).toThrow();
  });
  it("enables natural wording only with an explicit, credentialed renderer", () => {
    expect(readEnv(env({})).naturalAnswers.enabled).toBe(false);
    const voice = { LLM_RENDERER_PROVIDER: "openai", LLM_RENDERER_MODEL: "configured-model", OPENAI_API_KEY: "test-secret" };
    expect(readEnv(env(voice)).naturalAnswers.enabled).toBe(true);
    expect(readEnv(env({ ...voice, LLM_RENDERER_ENABLED: "false" })).naturalAnswers.enabled).toBe(false);
    expect(() => readEnv(env({ ...voice, OPENAI_API_KEY: "" }))).toThrow();
    expect(() => readEnv(env({ LLM_RENDERER_ENABLED: "true" }))).toThrow(/explicit LLM_RENDERER/);
    for (const key of ["ANSWER_CACHE_TTL_MS", "ANSWER_CACHE_MAX_ENTRIES", "LLM_RENDERER_TIMEOUT_MS", "LLM_RENDERER_MAX_OUTPUT_TOKENS"]) {
      expect(() => readEnv(env({ ...voice, [key]: "0" }))).toThrow();
    }
  });
  it("requires explicit production provider, model, credentials, and enabled verification", () => {
    const production = { NODE_ENV: "production", LLM_VERIFIER_PROVIDER: "openai", LLM_VERIFIER_MODEL: "configured-model", OPENAI_API_KEY: "test-secret" } as NodeJS.ProcessEnv;
    expect(() => readEnv(production)).not.toThrow();
    for (const key of ["LLM_VERIFIER_PROVIDER", "LLM_VERIFIER_MODEL", "OPENAI_API_KEY"]) {
      expect(() => readEnv({ ...production, [key]: " " })).toThrow();
    }
    expect(() => readEnv({ ...production, CLAIM_VERIFICATION: "false" })).toThrow(/CLAIM_VERIFICATION/);
    expect(() => readEnv({ ...production, EVIDENCE_PIPELINE_V2: "false" })).toThrow(/EVIDENCE_PIPELINE/);
    expect(() => readEnv(env({}))).not.toThrow();
  });

  it("validates configurable cache TTL and capacity", () => {
    expect(readEnv(env({ VERIFICATION_CACHE_ENABLED: "false", VERIFICATION_CACHE_TTL_MS: "500", VERIFICATION_CACHE_MAX_ENTRIES: "3" })).verificationCache)
      .toEqual({ enabled: false, ttlMs: 500, maxEntries: 3 });
    for (const value of ["0", "-1", "0.5", "NaN"]) {
      expect(() => readEnv(env({ VERIFICATION_CACHE_MAX_ENTRIES: value }))).toThrow();
    }
  });
  it("reads Azure verifier connection fields and an explicit deployment name", () => {
    const config = readEnv(env({
      LLM_PROVIDER: "azure",
      LLM_VERIFIER_PROVIDER: "azure",
      LLM_VERIFIER_MODEL: "gauravgpt-gpt54",
      AZURE_OPENAI_API_KEY: "azure-secret",
      AZURE_OPENAI_RESOURCE_NAME: "gauravgpt-resource",
      AZURE_OPENAI_API_VERSION: "v1",
    }));

    expect(config.models.verifier).toEqual({
      provider: "azure",
      model: "gauravgpt-gpt54",
      apiKey: "azure-secret",
      resourceName: "gauravgpt-resource",
      apiVersion: "v1",
    });
    expect(config.models.renderer.provider).toBe("google");
    expect(() => assertChatReady(config)).not.toThrow();
  });

  it("requires every Azure role to name its deployment explicitly", () => {
    expect(() => readEnv(env({ LLM_PROVIDER: "azure" }))).toThrowError(
      /LLM_VERIFIER_MODEL.*deployment name/i,
    );
    expect(() => readEnv(env({ LLM_RENDERER_PROVIDER: "azure" }))).toThrowError(
      /LLM_RENDERER_MODEL.*deployment name/i,
    );
  });

  it("defaults the Azure API version to v1 and validates the resource name", () => {
    const config = readEnv(env({
      LLM_PROVIDER: "azure",
      LLM_VERIFIER_MODEL: "gauravgpt-gpt54",
      AZURE_OPENAI_API_KEY: "azure-secret",
    }));
    expect(config.models.verifier).toMatchObject({ apiVersion: "v1" });
    expect(() => assertChatReady(config)).toThrowError(/AZURE_OPENAI_RESOURCE_NAME/);
  });

  it("keeps public OpenAI credentials separate from Azure credentials", () => {
    const publicOpenAI = readEnv(env({
      LLM_PROVIDER: "openai",
      OPENAI_API_KEY: "public-secret",
      AZURE_OPENAI_API_KEY: "azure-secret",
    }));
    expect(publicOpenAI.models.verifier.apiKey).toBe("public-secret");

    const azure = readEnv(env({
      LLM_PROVIDER: "azure",
      LLM_VERIFIER_MODEL: "gauravgpt-gpt54",
      OPENAI_API_KEY: "public-secret",
      AZURE_OPENAI_RESOURCE_NAME: "gauravgpt-resource",
    }));
    expect(azure.models.verifier.apiKey).toBeUndefined();
    expect(() => assertChatReady(azure)).toThrowError(ProviderUnavailableError);
    expect(() => assertChatReady(azure)).toThrowError(/AZURE_OPENAI_API_KEY/);
  });

  it("ignores the removed legacy LLM_MODEL override", () => {
    const config = readEnv(env({
      LLM_PROVIDER: "openai",
      LLM_MODEL: "legacy-model",
      LLM_VERIFIER_MODEL: "verifier-model",
      LLM_RENDERER_MODEL: "renderer-model",
    }));
    expect(config.models.verifier.model).toBe("verifier-model");
    expect(config.models.renderer.model).toBe("renderer-model");
  });
});
