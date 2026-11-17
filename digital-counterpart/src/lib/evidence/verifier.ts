import type { AtomicQuestion } from "./question";
import { answerExactFact } from "./exact-facts";
import type { FactStore } from "./fact-store";
import type { EvidenceVerifier, SupportAssessment } from "./support";
import { authorityPriority, supportAssessmentSchema } from "./support";
import type { EvidenceRecord, VerifiedClaim } from "./types";
import { RELIABILITY_VERSIONS } from "@/lib/versions";
import { inferCapabilityFromRecords } from "./capability-inference";
import { validateModelAssessment } from "./validation";

export const VERIFIER_PROMPT_VERSION = RELIABILITY_VERSIONS.verifier;

export interface ComplexEvidenceVerifier {
  verify(input: {
    question: AtomicQuestion;
    candidateEvidence: readonly EvidenceRecord[];
  }): Promise<SupportAssessment>;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Returns conflicts only for semantic records that claim the same subject/predicate. */
export function contradictoryEvidence(records: readonly EvidenceRecord[]): EvidenceRecord[] {
  const groups = new Map<string, EvidenceRecord[]>();
  for (const record of records) {
    if (!record.subject || !record.predicate || record.value === undefined) continue;
    const key = `${record.subject}\u0000${record.predicate}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  return [...groups.values()].flatMap((group) => {
    const active = group.filter(
      (record) => !record.validUntil || Date.parse(record.validUntil) >= Date.now(),
    );
    const strongestAuthority = Math.max(...active.map((record) => authorityPriority[record.authority]));
    const authoritative = active.filter(
      (record) => authorityPriority[record.authority] === strongestAuthority,
    );
    const dated = authoritative.filter((record) => record.validFrom);
    const considered =
      dated.length > 0
        ? dated.filter(
            (record) =>
              record.validFrom ===
              dated.map((item) => item.validFrom!).sort().at(-1),
          )
        : authoritative;
    if (considered.length < 2) return [];
    const first = considered[0].value;
    return considered.some((record) => !valuesEqual(record.value, first)) ? considered : [];
  });
}

function insufficient(question: AtomicQuestion, reason: string): SupportAssessment {
  return {
    questionId: question.id,
    question: question.text,
    status: "insufficient",
    claims: [],
    evidenceIds: [],
    method: "extractive",
    reason,
  };
}

export class DefaultEvidenceVerifier implements EvidenceVerifier {
  constructor(
    private readonly factStore: FactStore,
    private readonly complexVerifier?: ComplexEvidenceVerifier,
  ) {}

  async verify(input: {
    question: AtomicQuestion;
    candidateEvidence: readonly EvidenceRecord[];
  }): Promise<SupportAssessment> {
    const exact = answerExactFact(input.question, this.factStore);
    if (exact) return supportAssessmentSchema.parse(exact);

    const conflicts = contradictoryEvidence(input.candidateEvidence);
    if (conflicts.length > 0) {
      const claims: VerifiedClaim[] = [
        {
          id: `${input.question.id}:conflict`,
          text: "Gaurav's current records conflict on that.",
          kind: "uncertainty",
          evidenceIds: [],
        },
        ...conflicts.map((record, index) => ({
          id: `${input.question.id}:conflict:${index}`,
          text: `A ${record.authority} record states ${record.subject} ${record.predicate} as ${JSON.stringify(record.value)}.`,
          kind: "fact" as const,
          evidenceIds: [record.id],
        })),
      ];
      return supportAssessmentSchema.parse({
        questionId: input.question.id,
        question: input.question.text,
        status: "contradicted",
        claims,
        evidenceIds: conflicts.map((record) => record.id),
        method: "extractive",
        reason: "Authoritative records assert different values for the same proposition.",
      });
    }

    const structuredInference = inferCapabilityFromRecords(input.question, this.factStore);
    if (structuredInference) return structuredInference;

    if (input.candidateEvidence.length === 0) {
      return insufficient(input.question, "No candidate evidence is available for this proposition.");
    }

    // Narrative relevance and entailment require semantic assessment. Neither
    // vocabulary absence nor sentence overlap can decide whether we can answer.
    if (this.complexVerifier) {
      const assessment = await this.complexVerifier.verify(input);
      return validateModelAssessment(assessment, input);
    }

    return insufficient(input.question, "Candidate evidence did not establish the proposition.");
  }
}
