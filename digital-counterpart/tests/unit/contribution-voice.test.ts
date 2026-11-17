import { describe, expect, it, vi } from "vitest";
import { answerPortfolioQuestion } from "@/lib/chat/pipeline";
import { wantsTechnicalContribution } from "@/lib/chat/intent";
import { readEnv } from "@/lib/config";
import { loadProfile, loadProjects } from "@/lib/knowledge/loader";
import { Retriever } from "@/lib/rag/retriever";

const env = readEnv({ NODE_ENV: "test" });
const setup = () => ({ env, profile: loadProfile(), projects: loadProjects(), history: [], retriever: Retriever.fromIndexFile(undefined, env) });
const administrative = /canonical|profile records|profile lists|recorded status|recorded ownership|project metadata|Beyond code/i;

describe("direct, evidence-backed portfolio answers", () => {
  it.each([
    "What could Gaurav contribute technically?",
    "How could Gaurav help our engineering team?",
    "What would he bring to a software team?",
  ])("answers %s with contributions and concrete examples even without the writer", async (question) => {
    const result = await answerPortfolioQuestion({ ...setup(), question });
    if (result.kind !== "answer") throw new Error("Expected contribution assessment");
    expect(result.answer.text).toMatch(/^Gaurav could contribute in/);
    expect(result.answer.text).toMatch(/based on/);
    expect(result.answer.text).not.toMatch(administrative);
    for (const project of ["Satellite Classifier", "Smart Farm and Its Ecosystem"]) expect(result.answer.text).toContain(project);
    expect(result.answer.assessments[0].claims[0].kind).toBe("inference");
    expect(result.answer.citations.length).toBeGreaterThanOrEqual(4);
  });
  it("keeps provider-failure wording useful", async () => {
    const result = await answerPortfolioQuestion({ ...setup(),
      env: { ...env, naturalAnswers: { ...env.naturalAnswers, enabled: true } },
      question: "What could Gaurav contribute technically?",
      naturalAnswerModel: { rewrite: vi.fn().mockRejectedValue(new Error("Provider unavailable")), review: vi.fn() },
    });
    if (result.kind !== "answer") throw new Error("Expected fallback");
    expect(result.answer.rendering).toBe("deterministic");
    expect(result.answer.text).toMatch(/^Gaurav could contribute in/);
    expect(result.answer.text).not.toMatch(administrative);
  });
  it.each(["Could Gaurav contribute to quantum computing?", "How could Gaurav help our surgery team?"])("does not turn %s into a broad capability claim", (question) => {
    expect(wantsTechnicalContribution(question)).toBe(false);
  });
  it.each(["Where is Gaurav based?", "How old is he?", "Does he know PyTorch?", "What are his skills?", "What grades is he getting?", "Why should I hire Gaurav?", "What is Udaan's status?", "Has Gaurav never used Python?"])("keeps fallback wording conversational for %s", async (question) => {
    const result = await answerPortfolioQuestion({ ...setup(), question });
    if (result.kind !== "answer") throw new Error("Expected factual answer");
    expect(result.answer.text).not.toMatch(administrative);
  });
});
