import { z } from "zod";

import { supportStatusSchema } from "@/lib/evidence/support";
import { claimKinds } from "@/lib/evidence/types";

export const evalHistoryTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1),
});

export const evalExpectedClauseSchema = z.object({
  questionId: z.string().min(1).optional(),
  status: supportStatusSchema,
  /** Semantic identification can legitimately retain uncertainty while answering. */
  acceptableStatuses: z.array(supportStatusSchema).min(1).optional(),
  evidenceIds: z.array(z.string().min(1)).optional(),
});

export const evalExpectedSchema = z.object({
  route: z.string().min(1).optional(),
  resolvedQuestion: z.string().min(1).optional(),
  mustAssessSupport: z.boolean().optional(),
  clauses: z.array(evalExpectedClauseSchema).optional(),
  requiredFacts: z.array(z.string().min(1)).optional(),
  forbiddenClaims: z.array(z.string().min(1)).optional(),
  expectedProjectSlugs: z.array(z.string().min(1)).optional(),
  expectedVisual: z.string().min(1).optional(),
  expectedFailure: z
    .enum(["stale-index", "embedding-mismatch", "vector-dimension-mismatch"])
    .optional(),
});

export const evalCaseSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  history: z.array(evalHistoryTurnSchema).optional(),
  expected: evalExpectedSchema,
  tags: z.array(z.string().min(1)).min(1),
  /** Explicit context only for direct verifier contract evaluations. */
  contextEvidenceIds: z.array(z.string().min(1)).optional(),
});

export type EvalCase = z.infer<typeof evalCaseSchema>;

export const evalPredictionClaimSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(claimKinds),
  evidenceIds: z.array(z.string().min(1)),
});

export const evalPredictionSchema = z.object({
  id: z.string().min(1),
  route: z.string().min(1).optional(),
  resolvedQuestion: z.string().min(1).optional(),
  supportAssessmentQuestions: z.array(z.string().min(1)).optional(),
  supportAssessed: z.boolean().optional(),
  retrievedEvidenceIds: z.array(z.string().min(1)).optional(),
  clauses: z.array(evalExpectedClauseSchema).optional(),
  claims: z.array(evalPredictionClaimSchema).optional(),
  answer: z.string().optional(),
  visual: z.string().optional(),
  projectSlugs: z.array(z.string()).optional(),
  citations: z
    .array(
      z.object({
        claimId: z.string().min(1),
        evidenceId: z.string().min(1),
      }),
    )
    .optional(),
  checks: z
    .object({
      staleIndexRejected: z.boolean().optional(),
      embeddingMismatchRejected: z.boolean().optional(),
      vectorDimensionMismatchRejected: z.boolean().optional(),
    })
    .optional(),
});

export type EvalPrediction = z.infer<typeof evalPredictionSchema>;
