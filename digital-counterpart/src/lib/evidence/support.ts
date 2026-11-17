import { z } from "zod";

import { verifiedClaimSchema } from "./schema";
import type { EvidenceAuthority, EvidenceRecord, VerifiedClaim } from "./types";
import type { AtomicQuestion } from "./question";

export const supportStatuses = [
  "supported",
  "partially-supported",
  "contradicted",
  "insufficient",
  "not-recorded",
] as const;

export const supportStatusSchema = z.enum(supportStatuses);
export type SupportStatus = (typeof supportStatuses)[number];

export const supportAssessmentSchema = z
  .object({
    questionId: z.string().min(1),
    question: z.string().min(1),
    status: supportStatusSchema,
    claims: z.array(verifiedClaimSchema),
    evidenceIds: z.array(z.string().min(1)),
    method: z.enum([
      "exact-fact",
      "canonical-summary",
      "structured-inference",
      "extractive",
      "model",
      "exhaustive-absence",
    ]),
    /** Application policy route. It never carries portfolio claims or evidence. */
    responseMode: z.literal("instruction-boundary").optional(),
    reason: z.string().min(1).optional(),
  })
  .superRefine((assessment, context) => {
    if (
      assessment.responseMode === "instruction-boundary" &&
      (assessment.method !== "model" ||
        assessment.status !== "insufficient" ||
        assessment.claims.length > 0 ||
        assessment.evidenceIds.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["responseMode"],
        message: "instruction boundary decisions cannot carry portfolio claims or evidence",
      });
    }
    const establishes =
      assessment.status === "supported" ||
      assessment.status === "partially-supported" ||
      assessment.status === "contradicted";
    if (establishes && assessment.claims.length === 0) {
      context.addIssue({ code: "custom", path: ["claims"], message: "supported assessments require claims" });
    }
    if (!establishes && assessment.claims.length > 0) {
      context.addIssue({ code: "custom", path: ["claims"], message: "unsupported assessments cannot carry approved claims" });
    }
  });

export type SupportAssessment = z.infer<typeof supportAssessmentSchema>;

/**
 * A semantic decision that the visitor is asking about the authority of an
 * instruction embedded in untrusted content. The response mode keeps that
 * application policy separate from portfolio claims and evidence.
 */
export function isInstructionBoundaryDecision(
  decision: SupportAssessment,
): boolean {
  return decision.responseMode === "instruction-boundary";
}

/** Higher numbers win only when dated validity rules do not resolve a mutable fact. */
export const authorityPriority: Readonly<Record<EvidenceAuthority, number>> = {
  runtime: 700,
  profile: 600,
  "education-record": 550,
  "experience-record": 550,
  "project-record": 500,
  "repository-derived": 450,
  philosophy: 300,
  faq: 200,
};

export function assertClaimEvidence(
  claims: readonly VerifiedClaim[],
  evidence: readonly EvidenceRecord[],
): void {
  const evidenceIds = new Set(evidence.map((record) => record.id));
  for (const claim of claims) {
    verifiedClaimSchema.parse(claim);
    for (const evidenceId of claim.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`Claim ${claim.id} references unknown evidence ${evidenceId}`);
      }
    }
  }
}

export interface EvidenceVerifier {
  verify(input: {
    question: AtomicQuestion;
    candidateEvidence: readonly EvidenceRecord[];
  }): Promise<SupportAssessment>;
}
