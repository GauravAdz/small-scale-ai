import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { verifiedClaimSchema } from "@/lib/evidence/schema";
import { supportAssessmentSchema } from "@/lib/evidence/support";

describe("claim properties", () => {
  it("never accepts a fact with zero evidence IDs", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (id, text) => {
        expect(
          verifiedClaimSchema.safeParse({ id, text, kind: "fact", evidenceIds: [] }).success,
        ).toBe(false);
      }),
    );
  });

  it("never accepts unsupported statuses carrying factual claims", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("insufficient", "not-recorded"),
        fc.string({ minLength: 1 }),
        (status, text) => {
          expect(
            supportAssessmentSchema.safeParse({
              questionId: "q1",
              question: "question",
              status,
              claims: [{ id: "c1", text, kind: "fact", evidenceIds: ["e1"] }],
              evidenceIds: ["e1"],
              method: "model",
            }).success,
          ).toBe(false);
        },
      ),
    );
  });
});
