import { describe, expect, it } from "vitest";

import { citationsForPlan } from "@/lib/evidence/citations";
import type { EvidenceRecord } from "@/lib/evidence/types";

const evidence: EvidenceRecord = {
  id: "e1",
  docId: "d1",
  kind: "fact",
  authority: "profile",
  text: "Gaurav is in Linz.",
  locator: { source: "data/profile.json", jsonPointer: "/location" },
  sourceHash: "a".repeat(64),
};

describe("claim citations", () => {
  it("maps every claim evidence ID to exactly one record", () => {
    const citations = citationsForPlan(
      {
        clauses: [
          {
            questionId: "q1",
            status: "supported",
            claims: [{ id: "c1", text: evidence.text, kind: "fact", evidenceIds: ["e1"] }],
          },
        ],
      },
      [evidence],
    );
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      claimId: "c1",
      evidenceId: "e1",
      jsonPointer: "/location",
      provenance: "portfolio-record",
    });
  });

  it("fails closed on an invalid evidence ID", () => {
    expect(() =>
      citationsForPlan(
        {
          clauses: [
            {
              questionId: "q1",
              status: "supported",
              claims: [{ id: "c1", text: "x", kind: "fact", evidenceIds: ["missing"] }],
            },
          ],
        },
        [evidence],
      ),
    ).toThrow(/unknown evidence/i);
  });
});
