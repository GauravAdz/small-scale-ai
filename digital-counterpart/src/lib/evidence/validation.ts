import { EvidenceVerificationError } from "@/lib/errors";
import type { AtomicQuestion } from "./question";
import {
  supportAssessmentSchema,
  type SupportAssessment,
} from "./support";
import type { EvidenceRecord } from "./types";

/** Applied at both model and cache boundaries; never turn malformed output into abstention. */
export function validateModelAssessment(
  value: unknown,
  input: { question: AtomicQuestion; candidateEvidence: readonly EvidenceRecord[] },
): SupportAssessment {
  const parsed = supportAssessmentSchema.safeParse(value);
  if (!parsed.success) throw new EvidenceVerificationError("Verifier returned a malformed assessment.");
  const result = parsed.data;
  if (result.method !== "model" || result.status === "not-recorded" ||
      result.question !== input.question.text || result.questionId !== input.question.id) {
    throw new EvidenceVerificationError("Verifier assessed a different proposition or policy.");
  }
  if (result.responseMode === "instruction-boundary") return result;
  const allowed = new Set(input.candidateEvidence.map(({ id }) => id));
  const linked = new Set<string>();
  for (const claim of result.claims) {
    if (claim.kind === "uncertainty" || claim.evidenceIds.length === 0) {
      throw new EvidenceVerificationError("Model verifier returned an uncited claim.");
    }
    if (claim.kind === "inference" && !/^(based on|the evidence suggests|that appears)/i.test(claim.text)) {
      throw new EvidenceVerificationError("Model verifier returned an unlabelled inference.");
    }
    for (const id of claim.evidenceIds) {
      if (!allowed.has(id)) throw new EvidenceVerificationError("Model verifier returned an unknown evidence ID.");
      linked.add(id);
    }
  }
  if (result.evidenceIds.some((id) => !allowed.has(id) || !linked.has(id)) ||
      [...linked].some((id) => !result.evidenceIds.includes(id))) {
    throw new EvidenceVerificationError("Verifier evidence summary does not match its claims.");
  }
  return result;
}
