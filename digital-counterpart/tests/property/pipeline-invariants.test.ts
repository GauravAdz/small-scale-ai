import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { answerPortfolioQuestion } from "@/lib/chat/pipeline";
import { readEnv } from "@/lib/config";
import { loadProfile, loadProjects } from "@/lib/knowledge/loader";
import { Retriever } from "@/lib/rag/retriever";
import type { CounterpartMessage } from "@/types/chat";
import { abstainingOfflineVerifier } from "@/lib/evals/offline-verifier";

describe("pipeline properties", () => {
  it("ties an evidence-aware project visual to its approved relevance claim", async () => {
    const retriever = Retriever.fromIndexFile();
    const outcome = await answerPortfolioQuestion({
      question: "Tell me about Digital Counterpart.",
      history: [],
      profile: loadProfile(),
      projects: loadProjects(),
      env: readEnv(),
      retriever,
    });

    expect(outcome.kind).toBe("answer");
    if (outcome.kind !== "answer") return;
    expect(outcome.answer.visual?.kind).toBe("project-detail");
    if (outcome.answer.visual?.kind !== "project-detail") return;
    const project = outcome.answer.visual.project;
    expect(project.evidenceIds).toEqual(["evidence:projects/digital-counterpart"]);
    expect(
      outcome.answer.assessments
        .flatMap(({ claims }) => claims)
        .some(({ id }) => id === project.relevanceClaimId),
    ).toBe(true);
  });

  it("resolved follow-ups always receive clause-level evidence assessment", async () => {
    const retriever = Retriever.fromIndexFile();
    const profile = loadProfile();
    const projects = loadProjects();
    const history: CounterpartMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Tell me about Digital Counterpart." }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Untrusted prior answer." }] },
    ];
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 1_000_000 }), async (users) => {
        const outcome = await answerPortfolioQuestion({
          question: `Did it get ${users} users?`,
          history,
          profile,
          projects,
          env: readEnv(),
          retriever,
          complexVerifier: abstainingOfflineVerifier,
        });
        expect(outcome.kind).toBe("answer");
        if (outcome.kind === "answer") {
          expect(outcome.answer.resolvedQuestion).toContain("Digital Counterpart");
          expect(outcome.answer.assessments).toHaveLength(1);
          expect(outcome.answer.assessments[0].status).toBe("insufficient");
        }
      }),
      { numRuns: 20 },
    );
  });
});
