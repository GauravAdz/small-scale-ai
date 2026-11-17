import { describe, expect, it, vi } from "vitest";

import { DefaultEvidenceVerifier } from "@/lib/evidence/verifier";
import type { FactStore } from "@/lib/evidence/fact-store";

describe("query expansion boundary", () => {
  it("verifies the original atomic proposition, never expanded vocabulary", async () => {
    const complex = {
      verify: vi.fn(async ({ question }: { question: { id: string; text: string } }) => ({
        questionId: question.id,
        question: question.text,
        status: "insufficient" as const,
        claims: [],
        evidenceIds: [],
        method: "model" as const,
      })),
    };
    const factStore = {
      profile: { skills: [], education: [], contact: {}, pinnedProjects: [], focusAreas: [], links: [], metrics: [] },
      projects: [],
      evidenceById: new Map(),
      runtime: [],
    } as unknown as FactStore;
    const verifier = new DefaultEvidenceVerifier(factStore, complex);
    const original = "Explain the architecture?";
    const result = await verifier.verify({
      question: { id: "q1", text: original, kind: "descriptive" },
      candidateEvidence: [{ id: "e1", docId: "d1", text: "Documented work.", kind: "fact", authority: "profile", locator: { source: "data/profile.json" }, sourceHash: "a".repeat(64) }],
    });
    expect(result.question).toBe(original);
    expect(complex.verify).toHaveBeenCalledWith(
      expect.objectContaining({ question: expect.objectContaining({ text: original }) }),
    );
  });
});
