import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import {
  createGoogleGenerativeAI,
  type GoogleLanguageModelOptions,
} from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { generateText, LanguageModel } from "ai";
import { RELIABILITY_VERSIONS } from "@/lib/versions";

import {
  assertChatReady,
  readEnv,
  type EnvConfig,
  type AzureModelRoleConfig,
  type ModelRoleConfig,
} from "@/lib/config";

export function createAzureModel(
  role: AzureModelRoleConfig,
  factory: typeof createAzure = createAzure,
): LanguageModel {
  assertChatReady(role);
  const azure = factory({
    resourceName: role.resourceName,
    apiKey: role.apiKey,
    apiVersion: role.apiVersion,
  });
  return azure(role.model);
}

export function getModel(role: ModelRoleConfig): LanguageModel {
  assertChatReady(role);
  switch (role.provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey: role.apiKey })(role.model);
    case "openai":
      return createOpenAI({ apiKey: role.apiKey })(role.model);
    case "anthropic":
      return createAnthropic({ apiKey: role.apiKey })(role.model);
    case "azure":
      return createAzureModel(role);
  }
}

/**
 * One place that turns env config into a model handle. Swapping providers is a
 * `.env.local` edit, not a code change.
 */
export function getChatModel(config: EnvConfig = readEnv()): LanguageModel {
  return getModel(config.models.verifier);
}

/**
 * Keep model-specific generation controls beside model selection.
 *
 * This portfolio's retrieval layer has already done the hard evidence work.
 * Disable thinking for Gemini 2.5 Flash-Lite so short factual answers start
 * quickly and do not spend the output budget on hidden reasoning.
 */
export function getProviderOptions(role: ModelRoleConfig): Parameters<typeof generateText>[0]["providerOptions"] {
  if (role.provider === "openai" && role.model.startsWith("gpt-5.6")) {
    return { openai: { reasoningEffort: "medium", store: false,
      promptCacheKey: `counterpart-verifier-${RELIABILITY_VERSIONS.verifierPrompt}` } };
  }
  if (role.provider !== "google") {
    return undefined;
  }

  return {
    google: {
      thinkingConfig: {
        ...(role.model.startsWith("gemini-2.5-")
          ? { thinkingBudget: 0 }
          : { thinkingLevel: "minimal" as const }),
        includeThoughts: false,
      },
    } satisfies GoogleLanguageModelOptions,
  };
}

/** Semantic recovery is a small classification call and uses minimal reasoning. */
export function getInterpreterProviderOptions(
  role: ModelRoleConfig,
): Parameters<typeof generateText>[0]["providerOptions"] {
  if (role.provider === "openai" && role.model.startsWith("gpt-5.6")) {
    return {
      openai: {
        reasoningEffort: "low",
        store: false,
        promptCacheKey: `counterpart-interpreter-${RELIABILITY_VERSIONS.interpreterPrompt}`,
      },
    };
  }
  if (role.provider !== "google") return undefined;
  return {
    google: {
      thinkingConfig: {
        ...(role.model.startsWith("gemini-2.5-")
          ? { thinkingBudget: 0 }
          : { thinkingLevel: "minimal" as const }),
        includeThoughts: false,
      },
    } satisfies GoogleLanguageModelOptions,
  };
}

export function getChatProviderOptions(config: EnvConfig = readEnv()) {
  return getProviderOptions(config.models.verifier);
}

export function describeModel(config: EnvConfig = readEnv()): string {
  return `${config.models.verifier.provider}:${config.models.verifier.model}`;
}
