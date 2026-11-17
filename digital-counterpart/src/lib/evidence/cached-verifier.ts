import type { EnvConfig } from "@/lib/config";
import { EvidenceVerificationError, VerificationBudgetExceededError } from "@/lib/errors";
import { canonicalJson, sha256 } from "@/lib/knowledge/manifest";
import { RELIABILITY_VERSIONS } from "@/lib/versions";
import { providerErrorType, type VerificationObserver } from "@/lib/observability/verification";
import type { ComplexEvidenceVerifier } from "./verifier";
import type { VerificationCache } from "./verification-cache";
import { validateModelAssessment } from "./validation";
import { isInstructionBoundaryDecision } from "./support";

export const normalizeVerificationQuestion = (question: string): string =>
  question.trim().replace(/\s+/g, " ").toLowerCase();

export function verificationCacheKey(input: {
  question: string;
  indexDigest: string;
  verifierProvider: string;
  verifierModel: string;
  verifierPromptVersion: string;
  verificationPolicyVersion: string;
  contextDigest: string;
}): string {
  return `verification:v1:${sha256(canonicalJson({
    ...input, question: normalizeVerificationQuestion(input.question),
  }))}`;
}

/** One instance per visitor turn. Deterministic verification calls this only if unresolved. */
export class CachedEvidenceVerifier implements ComplexEvidenceVerifier {
  private modelCalls = 0;
  constructor(private readonly options: {
    verifier: ComplexEvidenceVerifier;
    cache?: VerificationCache;
    env: EnvConfig;
    indexDigest: string;
    observe: VerificationObserver;
  }) {}

  async verify(input: Parameters<ComplexEvidenceVerifier["verify"]>[0]) {
    const { env, indexDigest, observe, cache } = this.options;
    if (!indexDigest) throw new EvidenceVerificationError("Verification requires a current index digest.");
    if (input.candidateEvidence.length > env.verificationBudget.maxEvidenceItemsPerCall) {
      throw new VerificationBudgetExceededError("Verification evidence limit exceeded.");
    }
    const role = env.models.verifier;
    const key = verificationCacheKey({
      question: input.question.text,
      indexDigest,
      verifierProvider: role.provider,
      verifierModel: role.model,
      verifierPromptVersion: RELIABILITY_VERSIONS.verifierPrompt,
      verificationPolicyVersion: RELIABILITY_VERSIONS.verifier,
      contextDigest: sha256(canonicalJson({
        kind: input.question.kind,
        evidence: input.candidateEvidence,
        retrievalVersion: RELIABILITY_VERSIONS.retrieval,
        ...(role.provider === "azure" ? { resource: role.resourceName ?? "", apiVersion: role.apiVersion } : {}),
      })),
    });

    if (cache) {
      let cached;
      try { cached = await cache.get(key); }
      catch { observe({ name: "verification_cache_error" }); }
      if (cached) {
        try {
          // IDs belong to this clause/turn. Cache identity uses the standalone
          // question, never history or an incidental q1/q2 position.
          if (normalizeVerificationQuestion(cached.question) !== normalizeVerificationQuestion(input.question.text)) {
            throw new EvidenceVerificationError("Cached proposition mismatch.");
          }
          const result = validateModelAssessment(isInstructionBoundaryDecision(cached)
            ? { ...cached, questionId: input.question.id, question: input.question.text }
            : {
                ...cached,
                questionId: input.question.id,
                question: input.question.text,
                claims: cached.claims.map((claim, index) => ({
                  ...claim,
                  id: `${input.question.id}:model:${index}`,
                })),
              }, input);
          observe({ name: "verification_cache_hit" });
          return result;
        } catch { observe({ name: "verification_cache_invalid" }); }
      }
      observe({ name: "verification_cache_miss" });
    }

    if (this.modelCalls >= env.verificationBudget.maxModelCallsPerTurn) {
      throw new VerificationBudgetExceededError("Verifier call budget exhausted. Narrow the question.");
    }
    // Increment synchronously before awaiting: concurrent clauses share one budget.
    this.modelCalls++;
    observe({ name: "verification_llm" });
    const started = Date.now();
    try {
      const result = validateModelAssessment(await this.options.verifier.verify(input), input);
      observe({ name: "verification_llm_success" });
      if (cache) {
        try { await cache.set(key, result); }
        catch { observe({ name: "verification_cache_error" }); }
      }
      return result;
    } catch (error) {
      observe({ name: "verification_llm_failure", providerErrorType: providerErrorType(error) });
      throw error;
    } finally {
      observe({ name: "llm_latency_ms", value: Date.now() - started });
    }
  }
}
