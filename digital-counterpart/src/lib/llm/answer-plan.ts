import { z } from "zod";

import { verifiedClaimSchema } from "@/lib/evidence/schema";
import { supportAssessmentSchema, supportStatusSchema, type SupportAssessment } from "@/lib/evidence/support";
import type { VerifiedClaim } from "@/lib/evidence/types";

export const clauseAnswerSchema = z
  .object({
    questionId: z.string().min(1),
    status: supportStatusSchema,
    claims: z.array(verifiedClaimSchema),
  })
  .superRefine((clause, context) => {
    const unsupported = ["insufficient", "not-recorded"].includes(clause.status);
    if (unsupported && clause.claims.some(({ kind }) => kind !== "uncertainty")) {
      context.addIssue({ code: "custom", path: ["claims"], message: "unsupported clauses may only contain uncertainty" });
    }
  });

export const factualAnswerPlanSchema = z.object({
  clauses: z.array(clauseAnswerSchema).min(1),
  visual: z
    .object({
      show: z.boolean(),
      projectSlugs: z.array(z.string().min(1)).optional(),
    })
    .optional(),
});

export type ClauseAnswer = z.infer<typeof clauseAnswerSchema>;
export type FactualAnswerPlan = z.infer<typeof factualAnswerPlanSchema>;

function uncertaintyClaim(assessment: SupportAssessment): VerifiedClaim {
  const absentField = assessment.status === "not-recorded"
    ? assessment.reason?.match(/^(.+?) is absent from its canonical structured owner$/)?.[1]
    : undefined;
  const text =
    assessment.status === "contradicted"
      ? "Gaurav's current records conflict on that, so I can't state one version as fact."
      : assessment.status === "not-recorded"
        ? absentField
          ? `I don't have Gaurav's ${absentField} recorded.`
          : "I don't have that information about Gaurav."
        : "I don't have enough verified information in Gaurav's portfolio to answer that confidently.";
  return { id: `${assessment.questionId}:uncertainty`, text, kind: "uncertainty", evidenceIds: [] };
}

export function buildFactualPlan(
  assessments: readonly SupportAssessment[],
  visual?: FactualAnswerPlan["visual"],
): FactualAnswerPlan {
  return factualAnswerPlanSchema.parse({
    clauses: assessments.map((assessment) => ({
      questionId: assessment.questionId,
      status: assessment.status,
      claims:
        assessment.claims.length > 0
          ? assessment.claims
          : [uncertaintyClaim(supportAssessmentSchema.parse(assessment))],
    })),
    ...(visual ? { visual } : {}),
  });
}

export function claimsFromPlan(plan: FactualAnswerPlan): VerifiedClaim[] {
  return plan.clauses.flatMap((clause) => clause.claims);
}
