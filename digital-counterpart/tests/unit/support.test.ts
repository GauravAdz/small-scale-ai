import { describe, expect, it } from "vitest";

import type { FactStore } from "@/lib/evidence/fact-store";
import { contradictoryEvidence, DefaultEvidenceVerifier } from "@/lib/evidence/verifier";
import type { EvidenceRecord } from "@/lib/evidence/types";
import { ProviderUnavailableError } from "@/lib/errors";

const base = {
  docId: "fixture",
  kind: "fact" as const,
  authority: "profile" as const,
  text: "fixture",
  subject: "Gaurav",
  predicate: "location",
  locator: { source: "data/profile.json" },
  sourceHash: "a".repeat(64),
};

describe("support semantics", () => {
  it("exposes undated canonical contradictions", () => {
    const records: EvidenceRecord[] = [
      { ...base, id: "a", value: "Linz" },
      { ...base, id: "b", value: "Vienna" },
    ];
    expect(contradictoryEvidence(records).map(({ id }) => id)).toEqual(["a", "b"]);
  });

  it("allows an explicitly later valid value to supersede an older one", () => {
    const records: EvidenceRecord[] = [
      { ...base, id: "a", value: "Vienna", validFrom: "2025-01-01T00:00:00.000Z" },
      { ...base, id: "b", value: "Linz", validFrom: "2026-01-01T00:00:00.000Z" },
    ];
    expect(contradictoryEvidence(records)).toEqual([]);
  });

  it("does not let lower-authority narrative contradict a canonical fact", () => {
    const records: EvidenceRecord[] = [
      { ...base, id: "canonical", value: "Linz" },
      { ...base, id: "faq", authority: "faq", value: "Vienna" },
    ];
    expect(contradictoryEvidence(records)).toEqual([]);
  });

  it("uses a canonical positive skill fact to contradict a 'never used' premise", async () => {
    const skillEvidence: EvidenceRecord = {
      ...base,
      id: "evidence:profile:skills",
      predicate: "skills",
      value: ["Python"],
      text: "Python — Advanced",
    };
    const store = {
      profile: {
        name: "Gaurav",
        title: "Builder",
        bio: "",
        contact: {},
        focusAreas: [],
        links: [],
        metrics: [],
        education: [],
        pinnedProjects: [],
        skills: [{ group: "Languages", items: ["Python"] }],
      },
      projects: [],
      evidenceById: new Map([[skillEvidence.id, skillEvidence]]),
      runtime: [],
    } as unknown as FactStore;

    const result = await new DefaultEvidenceVerifier(store).verify({
      question: { id: "q1", text: "Has Gaurav never used Python?", kind: "capability" },
      candidateEvidence: [skillEvidence],
    });

    expect(result.status).toBe("contradicted");
    expect(result.evidenceIds).toEqual([skillEvidence.id]);
  });

  it("uses canonical project tags to contradict a 'without' premise", async () => {
    const projectEvidence: EvidenceRecord = {
      ...base,
      id: "evidence:projects/digital-counterpart",
      authority: "project-record",
      predicate: "summary",
      value: "A verified personal representation system built with Next.js and React.",
      text: "Digital Counterpart is a verified personal representation system built with Next.js and React.",
    };
    const store = {
      profile: {
        name: "Gaurav",
        title: "Builder",
        bio: "",
        contact: {},
        focusAreas: [],
        links: [],
        metrics: [],
        education: [],
        pinnedProjects: [],
        skills: [],
      },
      projects: [{
        title: "Digital Counterpart",
        slug: "digital-counterpart",
        type: "project",
        weight: 100,
        tags: ["React"],
        summary: "a verified personal representation system built with Next.js and React.",
        featured: true,
      }],
      evidenceById: new Map([[projectEvidence.id, projectEvidence]]),
      runtime: [],
    } as unknown as FactStore;

    const result = await new DefaultEvidenceVerifier(store).verify({
      question: { id: "q1", text: "Did he build Digital Counterpart without React?", kind: "descriptive" },
      candidateEvidence: [projectEvidence],
    });

    expect(result.status).toBe("contradicted");
    expect(result.evidenceIds).toEqual([projectEvidence.id]);
    expect(result.claims[0].text).toContain("React");
  });

  it("does not convert provider unavailability into insufficient evidence", async () => {
    const unavailable = new ProviderUnavailableError("verifier unavailable", {
      provider: "azure",
      model: "gauravgpt-gpt54",
      code: "http_503",
      retryable: true,
    });
    const complexVerifier = { verify: async () => { throw unavailable; } };
    const store = {
      profile: { skills: [], education: [], contact: {}, pinnedProjects: [], focusAreas: [], links: [], metrics: [] },
      projects: [],
      evidenceById: new Map(),
      runtime: [],
    } as unknown as FactStore;

    await expect(new DefaultEvidenceVerifier(store, complexVerifier).verify({
      question: { id: "q1", text: "Summarize Gaurav's work?", kind: "unknown" },
      candidateEvidence: [{ ...base, id: "e1" }],
    })).rejects.toBe(unavailable);
  });
});
