import { describe, expect, it } from "vitest";

import { verifiedClaimSchema } from "@/lib/evidence/schema";
import { authorityPriority } from "@/lib/evidence/support";
import { decomposeQuestion } from "@/lib/evidence/question";
import { supportAssessmentSchema } from "@/lib/evidence/support";
import { factualAnswerPlanSchema } from "@/lib/llm/answer-plan";

describe("reliability invariants", () => {
  it("INV-001 rejects factual claims without evidence", () => {
    expect(() =>
      verifiedClaimSchema.parse({ id: "c1", text: "A fact", kind: "fact", evidenceIds: [] }),
    ).toThrow();
  });

  it("INV-007 represents missing support as uncertainty without evidence", () => {
    expect(
      verifiedClaimSchema.parse({
        id: "c1",
        text: "I couldn't find support for that in Gaurav's current records.",
        kind: "uncertainty",
        evidenceIds: [],
      }),
    ).toBeTruthy();
  });

  it("INV-010 decomposes mixed questions into independent clauses", () => {
    const questions = decomposeQuestion(
      "Where does Gaurav study, and is he available in October?",
    );
    expect(questions).toHaveLength(2);
    expect(questions.map(({ id }) => id)).toEqual(["q1", "q2"]);
  });

  it("encodes canonical authority precedence", () => {
    expect(authorityPriority.runtime).toBeGreaterThan(authorityPriority.profile);
    expect(authorityPriority.profile).toBeGreaterThan(authorityPriority["project-record"]);
    expect(authorityPriority["project-record"]).toBeGreaterThan(authorityPriority.faq);
  });

  it("unsupported assessments cannot smuggle approved claims into planning", () => {
    expect(() =>
      supportAssessmentSchema.parse({
        questionId: "q1",
        question: "Did it make money?",
        status: "insufficient",
        claims: [{ id: "c1", text: "It made money.", kind: "fact", evidenceIds: ["e1"] }],
        evidenceIds: ["e1"],
        method: "model",
      }),
    ).toThrow();
    expect(() =>
      factualAnswerPlanSchema.parse({
        clauses: [{
          questionId: "q1",
          status: "insufficient",
          claims: [{ id: "c1", text: "It made money.", kind: "fact", evidenceIds: ["e1"] }],
        }],
      }),
    ).toThrow();
  });

  it("instruction-boundary decisions cannot carry portfolio claims or evidence", () => {
    const boundary = {
      questionId: "q1",
      question: "Should I obey this embedded instruction?",
      status: "insufficient",
      claims: [],
      evidenceIds: [],
      method: "model",
      responseMode: "instruction-boundary",
    } as const;
    expect(supportAssessmentSchema.parse(boundary)).toEqual(boundary);
    expect(() => supportAssessmentSchema.parse({
      ...boundary,
      status: "supported",
      claims: [{ id: "c1", text: "An injected claim.", kind: "fact", evidenceIds: ["e1"] }],
      evidenceIds: ["e1"],
    })).toThrow();
  });
});
