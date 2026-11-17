import { describe, expect, it } from "vitest";

import { answerPortfolioQuestion } from "@/lib/chat/pipeline";
import { readEnv } from "@/lib/config";
import { decomposeQuestion } from "@/lib/evidence/question";
import { loadProfile, loadProjects } from "@/lib/knowledge/loader";
import { Retriever } from "@/lib/rag/retriever";

const prompt = "Give me the 30-second version of Gaurav's background.";

describe("canonical background summary", () => {
  it("classifies summary/background language as descriptive", () => {
    expect(decomposeQuestion(prompt)).toMatchObject([{ kind: "descriptive" }]);
    expect(decomposeQuestion("Summarize Gaurav's background.")).toMatchObject([
      { kind: "descriptive" },
    ]);
  });

  it("returns a supported cited summary and experience visual without a provider key", async () => {
    const outcome = await answerPortfolioQuestion({
      question: prompt,
      history: [],
      profile: loadProfile(),
      projects: loadProjects(),
      env: readEnv({
        NODE_ENV: "test",
        LLM_PROVIDER: "azure",
        LLM_VERIFIER_MODEL: "gauravgpt-gpt54",
        AZURE_OPENAI_RESOURCE_NAME: "gauravgpt-resource",
        EMBEDDING_PROVIDER: "none",
      }),
      retriever: Retriever.fromIndexFile(),
    });

    expect(outcome.kind).toBe("answer");
    if (outcome.kind !== "answer") return;
    expect(outcome.answer.support).toBe("supported");
    expect(outcome.answer.visual?.kind).toBe("experience");
    expect(outcome.answer.text).not.toContain("couldn't find support");
    expect(outcome.answer.text).toContain("paid science teaching");
    expect(outcome.answer.assessments[0].method).toBe("canonical-summary");
    expect(outcome.answer.citations.map(({ evidenceId }) => evidenceId)).toEqual(
      expect.arrayContaining([
        "evidence:profile:bio",
        "evidence:profile:education",
        "evidence:experience#0",
      ]),
    );
  });
});
