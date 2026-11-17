import { describe, expect, it } from "vitest";
import { auditCitations, predictionFailures } from "@/lib/evals/validation";
import type { EvalCase, EvalPrediction } from "@/lib/evals/schema";

const prediction: EvalPrediction = {
  id: "case", route: "answer", supportAssessed: true,
  clauses: [{ status: "supported", evidenceIds: ["e1"] }],
  claims: [{ id: "c1", text: "Recorded work", kind: "fact", evidenceIds: ["e1"] }],
  citations: [{ claimId: "c1", evidenceId: "e1" }],
};
const item: EvalCase = { id: "case", question: "What work?", tags: ["fact"], expected: { clauses: [{ status: "supported", evidenceIds: ["e1"] }] } };
const valid = new Set(["e1", "e2"]);

describe("evaluation reliability gates", () => {
  it("accepts complete provenance and rejects a missing or swapped citation", () => {
    expect(auditCitations([prediction], valid).failures).toEqual([]);
    for (const citations of [[], [{ claimId: "c1", evidenceId: "e2" }], [{ claimId: "other", evidenceId: "e1" }]]) {
      const audit = auditCitations([{ ...prediction, citations }], valid);
      expect(audit.failures.length).toBeGreaterThan(0);
      expect(audit.citedClaims).toBe(0);
    }
  });

  it("requires all supporting evidence links and rejects fabricated runtime IDs", () => {
    for (const evidenceIds of [["e1", "e2"], ["runtime:made-up"]]) {
      const result = { ...prediction, claims: [{ ...prediction.claims![0], evidenceIds }] };
      expect(auditCitations([result], valid).failures.length).toBeGreaterThan(0);
    }
  });

  it("rejects incomplete clauses and missing required evidence in live evaluations", () => {
    expect(predictionFailures(item, prediction)).toEqual([]);
    expect(predictionFailures(item, { ...prediction, clauses: [] })).toContain("case: incorrect clause count");
    expect(predictionFailures(item, { ...prediction, clauses: [{ status: "supported", evidenceIds: ["e2"] }] }))
      .toContain("case: missing required evidence e1");
  });

  it("fails when an expected inference is presented as fact", () => {
    expect(predictionFailures({ ...item, tags: ["inference"] }, prediction)).toContain("case: inference not labelled");
  });

  it("accepts only proven child excerpts for a parent source expectation", () => {
    const excerpts = new Map([["excerpt", "e1"], ["sibling", "e1"]]);
    const result = { ...prediction, clauses: [{ status: "supported" as const, evidenceIds: ["excerpt"] }] };
    expect(predictionFailures(item, result, excerpts)).toEqual([]);
    expect(predictionFailures(item, result)).toContain("case: missing required evidence e1");
    const specific = { ...item, expected: { clauses: [{ status: "supported" as const, evidenceIds: ["sibling"] }] } };
    expect(predictionFailures(specific, result, excerpts)).toContain("case: missing required evidence sibling");
  });

  it("checks conversation support and rejects local bypasses", () => {
    const followup = { ...item, expected: { mustAssessSupport: true, resolvedQuestion: "Resolved", clauses: [{ status: "insufficient" as const }] } };
    expect(predictionFailures(followup, { id: "case", route: "local" })).toEqual(expect.arrayContaining([
      "case: support assessment bypassed", "case: incorrect resolved question", "case: incorrect clause count",
    ]));
    expect(predictionFailures({ ...item, expected: { clauses: [{ status: "insufficient" }] } }, { id: "case", route: "local" })).toEqual([]);
  });
});
