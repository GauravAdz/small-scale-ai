import type { ComplexEvidenceVerifier } from "@/lib/evidence/verifier";

/**
 * Explicit fixture for credential-free deterministic evaluations. Production
 * never imports this adapter; provider unavailability there remains an error.
 */
export const abstainingOfflineVerifier: ComplexEvidenceVerifier = {
  async verify({ question }) {
    return {
      questionId: question.id,
      question: question.text,
      status: "insufficient",
      claims: [],
      evidenceIds: [],
      method: "model",
      reason: "Offline evaluation fixture did not establish the proposition.",
    };
  },
};
