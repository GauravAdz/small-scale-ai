import { z } from "zod";

import { ProviderUnavailableError } from "@/lib/errors";
import counterpartConfig from "../../counterpart.config";

/**
 * Environment parsing. Everything the app reads from `process.env` funnels
 * through here so a missing or misspelled variable fails loudly and in one place.
 */

export type LlmProvider = "google" | "anthropic" | "openai" | "azure";
export type StandardLlmProvider = Exclude<LlmProvider, "azure">;
export type EmbeddingProvider = "none" | "google" | "voyage" | "openai";
export type VectorStoreKind = "memory" | "pinecone" | "supabase";
export type ContactDelivery = "none" | "resend" | "webhook";
export type RerankerKind = "none" | "voyage" | "cohere";

export type StandardModelRoleConfig = Readonly<{
  provider: StandardLlmProvider;
  model: string;
  apiKey: string | undefined;
}>;

export type AzureModelRoleConfig = Readonly<{
  provider: "azure";
  /** Azure deployment name, not the underlying model-family name. */
  model: string;
  apiKey: string | undefined;
  resourceName: string | undefined;
  apiVersion: string;
}>;

export type ModelRoleConfig = StandardModelRoleConfig | AzureModelRoleConfig;

const DEFAULT_MODELS: Record<StandardLlmProvider, string> = {
  // Retrieval supplies the facts; the model only has to produce a short,
  // grounded synthesis. Flash-Lite is the best speed/cost fit for that job.
  google: "gemini-2.5-flash-lite",
  anthropic: "claude-opus-5",
  openai: "gpt-4.1",
};

const DEFAULT_EMBEDDING_MODELS: Record<Exclude<EmbeddingProvider, "none">, string> = {
  google: "gemini-embedding-001",
  voyage: "voyage-3.5-lite",
  openai: "text-embedding-3-small",
};

/** Env var holding each provider's key. */
const LLM_KEY_VARS: Record<StandardLlmProvider, string> = {
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/**
 * `gemini-embedding-001` returns 3072 dimensions by default, which balloons the
 * committed index file (~2 MB for a small corpus). 768 keeps retrieval quality
 * while keeping the JSON small enough to live in git comfortably.
 */
const DEFAULT_EMBEDDING_DIMENSIONS: Partial<Record<EmbeddingProvider, number>> = {
  google: 768,
  voyage: 1024,
  openai: 1536,
};

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  varName: string,
): T {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase() as T;
  if (!allowed.includes(normalized)) {
    throw new Error(
      `${varName} must be one of ${allowed.join(" | ")} — got "${value}".`,
    );
  }
  return normalized;
}

export type EnvConfig = {
  naturalAnswers: { enabled: boolean; cacheEnabled: boolean; ttlMs: number; maxEntries: number; timeoutMs: number; maxOutputTokens: number };
  semanticRecovery: { enabled: boolean; timeoutMs: number; maxOutputTokens: number; acceptConfidence: number; clarifyConfidence: number };
  verificationCache: { enabled: boolean; ttlMs: number; maxEntries: number };
  verificationBudget: { maxModelCallsPerTurn: number; maxEvidenceItemsPerCall: number; concurrency: number; timeoutMs: number };
  /** Backward-compatible alias for the active verifier model. */
  llm: ModelRoleConfig;
  models: {
    verifier: ModelRoleConfig;
    renderer: ModelRoleConfig;
    interpreter: ModelRoleConfig;
  };
  features: {
    evidencePipeline: { kind: "v2" } | { kind: "disabled" };
    claimVerification: { kind: "strict" } | { kind: "exact-only" };
    reranker: { kind: RerankerKind };
    observability: { kind: "enabled" } | { kind: "disabled" };
  };
  embeddings: {
    provider: EmbeddingProvider;
    model: string | null;
    apiKey: string | undefined;
    /** null = use the provider's own default. */
    dimensions: number | null;
  };
  store: {
    kind: VectorStoreKind;
    pinecone: { apiKey?: string; host?: string; namespace: string };
    supabase: { url?: string; serviceKey?: string; table: string };
  };
  limits: {
    rate: {
      enabled: boolean;
      requests: number;
      windowSeconds: number;
      upstash: { url?: string; token?: string };
    };
    /** Longest single message accepted. Real questions are short. */
    maxMessageChars: number;
  };
  contact: {
    /**
     * Which delivery adapter is wired up. `none` is a supported state, not a
     * broken one: the form still validates and opens a draft in the visitor's
     * email app rather than claiming a message was sent.
     */
    delivery: ContactDelivery;
    resend: { apiKey?: string; to?: string; from: string };
    webhookUrl?: string;
  };
  siteUrl: string | undefined;
};

const environmentSchema = z
  .object({
    LLM_PROVIDER: z.string().optional(),
    LLM_VERIFIER_PROVIDER: z.string().optional(),
    LLM_VERIFIER_MODEL: z.string().optional(),
    LLM_RENDERER_PROVIDER: z.string().optional(),
    LLM_RENDERER_MODEL: z.string().optional(),
    LLM_INTERPRETER_ENABLED: z.string().optional(),
    LLM_INTERPRETER_PROVIDER: z.string().optional(),
    LLM_INTERPRETER_MODEL: z.string().optional(),
    LLM_INTERPRETER_TIMEOUT_MS: z.string().optional(),
    AZURE_OPENAI_API_KEY: z.string().optional(),
    AZURE_OPENAI_RESOURCE_NAME: z.string().optional(),
    AZURE_OPENAI_API_VERSION: z.string().optional(),
    EMBEDDING_PROVIDER: z.string().optional(),
    EMBEDDING_MODEL: z.string().optional(),
    EMBEDDING_DIMENSIONS: z.string().optional(),
    VECTOR_STORE: z.string().optional(),
    RERANKER: z.string().optional(),
    EVIDENCE_PIPELINE_V2: z.string().optional(),
    CLAIM_VERIFICATION: z.string().optional(),
    OBSERVABILITY_ENABLED: z.string().optional(),
  })
  .passthrough();

function enabled(value: string | undefined, fallback: boolean, variable: string): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${variable} must be true or false — got "${value}".`);
}

function modelRole(
  env: NodeJS.ProcessEnv,
  role: "VERIFIER" | "RENDERER",
  legacyProvider: LlmProvider,
): ModelRoleConfig {
  const provider = oneOf(
    env[`LLM_${role}_PROVIDER`],
    ["google", "anthropic", "openai", "azure"] as const,
    legacyProvider,
    `LLM_${role}_PROVIDER`,
  );

  const model = env[`LLM_${role}_MODEL`]?.trim();
  if (provider === "azure") {
    if (!model) {
      throw new ProviderUnavailableError(
        `LLM_${role}_MODEL is not configured. Azure roles require an explicit deployment name.`,
        { provider, code: "missing_configuration", retryable: false },
      );
    }
    return {
      provider,
      model,
      apiKey: env.AZURE_OPENAI_API_KEY,
      resourceName: env.AZURE_OPENAI_RESOURCE_NAME?.trim() || undefined,
      apiVersion: env.AZURE_OPENAI_API_VERSION?.trim() || "v1",
    };
  }

  return {
    provider,
    model: model || DEFAULT_MODELS[provider],
    apiKey: env[LLM_KEY_VARS[provider]],
  };
}

/** The interpreter reuses the verifier role unless an explicit cheaper role is configured. */
function interpreterRole(
  env: NodeJS.ProcessEnv,
  verifier: ModelRoleConfig,
): ModelRoleConfig {
  const configuredProvider = env.LLM_INTERPRETER_PROVIDER?.trim();
  const provider = configuredProvider
    ? oneOf(
        configuredProvider,
        ["google", "anthropic", "openai", "azure"] as const,
        verifier.provider,
        "LLM_INTERPRETER_PROVIDER",
      )
    : verifier.provider;
  const configuredModel = env.LLM_INTERPRETER_MODEL?.trim();
  const model = configuredModel || (provider === verifier.provider ? verifier.model : undefined);

  if (provider === "azure") {
    if (!model) {
      throw new ProviderUnavailableError(
        "LLM_INTERPRETER_MODEL is required when the interpreter uses a separate Azure provider.",
        { provider, code: "missing_configuration", retryable: false },
      );
    }
    return {
      provider,
      model,
      apiKey: env.AZURE_OPENAI_API_KEY,
      resourceName: env.AZURE_OPENAI_RESOURCE_NAME?.trim() || undefined,
      apiVersion: env.AZURE_OPENAI_API_VERSION?.trim() || "v1",
    };
  }

  return {
    provider,
    model: model || DEFAULT_MODELS[provider],
    apiKey: env[LLM_KEY_VARS[provider]],
  };
}

/** Parse a positive integer env var. Unset uses a documented default; invalid fails. */
function positiveInt(value: string | undefined, fallback: number, variable = "integer setting"): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${variable} must be a positive integer — got "${value}".`);
  }
  return Math.floor(parsed);
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  environmentSchema.parse(env);
  if (env.NODE_ENV === "production") {
    for (const variable of ["LLM_VERIFIER_PROVIDER", "LLM_VERIFIER_MODEL"] as const) {
      if (!env[variable]?.trim()) {
        throw new ProviderUnavailableError(`${variable} must be explicitly configured in production.`, {
          code: "missing_configuration", retryable: false,
        });
      }
    }
    if (!enabled(env.CLAIM_VERIFICATION, true, "CLAIM_VERIFICATION") ||
        !enabled(env.EVIDENCE_PIPELINE_V2, true, "EVIDENCE_PIPELINE_V2")) {
      throw new Error("Production requires CLAIM_VERIFICATION=true and EVIDENCE_PIPELINE_V2=true.");
    }
  }
  const llmProvider = oneOf(
    env.LLM_PROVIDER,
    ["google", "anthropic", "openai", "azure"] as const,
    "google",
    "LLM_PROVIDER",
  );

  // Lexical-only retrieval is a supported, explicit mode. Semantic retrieval
  // may improve recall, but support verification—not similarity—remains the
  // factual gate, so a missing embedding provider must not weaken precision.
  const embeddingProvider = oneOf(
    env.EMBEDDING_PROVIDER,
    ["none", "google", "voyage", "openai"] as const,
    "none",
    "EMBEDDING_PROVIDER",
  );

  const storeKind = oneOf(
    env.VECTOR_STORE,
    ["memory", "pinecone", "supabase"] as const,
    "memory",
    "VECTOR_STORE",
  );
  // Rendering is enabled only through explicit role configuration; offline
  // evaluations and installations without a renderer keep the local fallback.
  const renderer = modelRole(env, "RENDERER", "google");
  const verifier = modelRole(env, "VERIFIER", llmProvider);
  const interpreter = interpreterRole(env, verifier);
  const naturalAnswersEnabled = enabled(env.LLM_RENDERER_ENABLED,
    Boolean(env.LLM_RENDERER_PROVIDER?.trim() && env.LLM_RENDERER_MODEL?.trim()), "LLM_RENDERER_ENABLED");
  if (naturalAnswersEnabled) {
    if (!env.LLM_RENDERER_PROVIDER?.trim() || !env.LLM_RENDERER_MODEL?.trim()) {
      throw new Error("Natural answers require explicit LLM_RENDERER_PROVIDER and LLM_RENDERER_MODEL.");
    }
    assertChatReady(renderer);
  }
  if (env.NODE_ENV === "production") assertChatReady(verifier);
  const reranker = oneOf(
    env.RERANKER,
    ["none", "voyage", "cohere"] as const,
    "none",
    "RERANKER",
  );

  return {
    naturalAnswers: {
      enabled: naturalAnswersEnabled,
      cacheEnabled: enabled(env.ANSWER_CACHE_ENABLED, true, "ANSWER_CACHE_ENABLED"),
      ttlMs: positiveInt(env.ANSWER_CACHE_TTL_MS, 86_400_000, "ANSWER_CACHE_TTL_MS"),
      maxEntries: positiveInt(env.ANSWER_CACHE_MAX_ENTRIES, 1000, "ANSWER_CACHE_MAX_ENTRIES"),
      timeoutMs: positiveInt(env.LLM_RENDERER_TIMEOUT_MS, 20_000, "LLM_RENDERER_TIMEOUT_MS"),
      maxOutputTokens: positiveInt(env.LLM_RENDERER_MAX_OUTPUT_TOKENS, 1600, "LLM_RENDERER_MAX_OUTPUT_TOKENS"),
    },
    semanticRecovery: {
      enabled: enabled(
        env.LLM_INTERPRETER_ENABLED,
        counterpartConfig.semanticRecovery.enabled,
        "LLM_INTERPRETER_ENABLED",
      ),
      timeoutMs: positiveInt(
        env.LLM_INTERPRETER_TIMEOUT_MS,
        counterpartConfig.semanticRecovery.timeoutMs,
        "LLM_INTERPRETER_TIMEOUT_MS",
      ),
      maxOutputTokens: counterpartConfig.semanticRecovery.maxOutputTokens,
      acceptConfidence: counterpartConfig.semanticRecovery.acceptConfidence,
      clarifyConfidence: counterpartConfig.semanticRecovery.clarifyConfidence,
    },
    verificationCache: {
      enabled: enabled(env.VERIFICATION_CACHE_ENABLED, counterpartConfig.verificationCache.enabled, "VERIFICATION_CACHE_ENABLED"),
      ttlMs: positiveInt(env.VERIFICATION_CACHE_TTL_MS, counterpartConfig.verificationCache.ttlMs, "VERIFICATION_CACHE_TTL_MS"),
      maxEntries: positiveInt(env.VERIFICATION_CACHE_MAX_ENTRIES, counterpartConfig.verificationCache.maxEntries, "VERIFICATION_CACHE_MAX_ENTRIES"),
    },
    verificationBudget: { ...counterpartConfig.verificationBudget },
    llm: verifier,
    models: { verifier, renderer, interpreter },
    features: {
      evidencePipeline: enabled(env.EVIDENCE_PIPELINE_V2, true, "EVIDENCE_PIPELINE_V2")
        ? { kind: "v2" }
        : { kind: "disabled" },
      claimVerification: enabled(env.CLAIM_VERIFICATION, true, "CLAIM_VERIFICATION")
        ? { kind: "strict" }
        : { kind: "exact-only" },
      reranker: { kind: reranker },
      observability: enabled(env.OBSERVABILITY_ENABLED, false, "OBSERVABILITY_ENABLED")
        ? { kind: "enabled" }
        : { kind: "disabled" },
    },
    embeddings: {
      provider: embeddingProvider,
      model:
        embeddingProvider === "none"
          ? null
          : env.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODELS[embeddingProvider],
      apiKey:
        embeddingProvider === "none"
          ? undefined
          : embeddingProvider === "voyage"
            ? env.VOYAGE_API_KEY
            : embeddingProvider === "google"
              ? env.GOOGLE_GENERATIVE_AI_API_KEY
              : env.OPENAI_API_KEY,
      dimensions: env.EMBEDDING_DIMENSIONS
        ? positiveInt(env.EMBEDDING_DIMENSIONS, 1, "EMBEDDING_DIMENSIONS")
        : (DEFAULT_EMBEDDING_DIMENSIONS[embeddingProvider] ?? null),
    },
    store: {
      kind: storeKind,
      pinecone: {
        apiKey: env.PINECONE_API_KEY,
        host: env.PINECONE_INDEX_HOST,
        namespace: env.PINECONE_NAMESPACE?.trim() || "counterpart",
      },
      supabase: {
        url: env.SUPABASE_URL,
        serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
        table: env.SUPABASE_TABLE?.trim() || "counterpart_documents",
      },
    },
    limits: {
      rate: {
        // Opt-out rather than opt-in: an unguarded public endpoint that spends
        // quota is not a safe default to ship.
        enabled: enabled(env.RATE_LIMIT_ENABLED, true, "RATE_LIMIT_ENABLED"),
        requests: positiveInt(env.RATE_LIMIT_REQUESTS, 12, "RATE_LIMIT_REQUESTS"),
        windowSeconds: positiveInt(env.RATE_LIMIT_WINDOW_SECONDS, 60, "RATE_LIMIT_WINDOW_SECONDS"),
        upstash: {
          url: env.UPSTASH_REDIS_REST_URL,
          token: env.UPSTASH_REDIS_REST_TOKEN,
        },
      },
      maxMessageChars: positiveInt(env.MAX_MESSAGE_CHARS, 2000, "MAX_MESSAGE_CHARS"),
    },
    contact: {
      // Inferred from which credentials exist rather than requiring a second
      // variable to agree with the first — one fewer way to misconfigure it.
      delivery: env.RESEND_API_KEY
        ? "resend"
        : env.CONTACT_WEBHOOK_URL
          ? "webhook"
          : "none",
      resend: {
        apiKey: env.RESEND_API_KEY,
        to: env.CONTACT_TO_EMAIL,
        // Resend's shared sender is suitable for testing when `to` is the
        // account owner's address. Production delivery to any other inbox
        // requires CONTACT_FROM_EMAIL on a verified domain.
        from: env.CONTACT_FROM_EMAIL?.trim() || "GauravGPT <onboarding@resend.dev>",
      },
      webhookUrl: env.CONTACT_WEBHOOK_URL,
    },
    // Vercel injects the production domain, so previews and prod get working
    // OG metadata without anyone remembering to set a variable.
    siteUrl:
      env.NEXT_PUBLIC_SITE_URL ??
      (env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
        : undefined),
  };
}

/** Throws with an actionable message if the chat route can't possibly work. */
export function assertChatReady(config: EnvConfig | ModelRoleConfig): void {
  const role = "llm" in config ? config.models.verifier : config;
  if (!role.model.trim()) {
    throw new ProviderUnavailableError(
      `${role.provider === "azure" ? "LLM_VERIFIER_MODEL" : "The model identifier"} is not configured.`,
      { provider: role.provider, code: "missing_configuration", retryable: false },
    );
  }
  if (!role.apiKey?.trim()) {
    const key = role.provider === "azure" ? "AZURE_OPENAI_API_KEY" : LLM_KEY_VARS[role.provider];
    const hint =
      role.provider === "google"
        ? " Get a free one at https://aistudio.google.com/apikey."
        : "";
    throw new ProviderUnavailableError(
      `${key} is not configured. Copy .env.example to .env.local and add the secret.${hint}`,
      {
        provider: role.provider,
        model: role.model,
        code: "missing_configuration",
        retryable: false,
      },
    );
  }
  if (role.provider === "azure" && !role.resourceName) {
    throw new ProviderUnavailableError(
      "AZURE_OPENAI_RESOURCE_NAME is not configured.",
      {
        provider: role.provider,
        model: role.model,
        code: "missing_configuration",
        retryable: false,
      },
    );
  }
}
