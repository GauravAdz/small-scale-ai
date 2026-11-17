import { describe, expect, it, vi } from "vitest";

import { answerPortfolioQuestion } from "@/lib/chat/pipeline";
import { readEnv } from "@/lib/config";
import { loadProfile, loadProjects } from "@/lib/knowledge/loader";
import { Retriever } from "@/lib/rag/retriever";
import { abstainingOfflineVerifier } from "@/lib/evals/offline-verifier";

const env = readEnv({ NODE_ENV: "test" });
const profile = loadProfile();
const projects = loadProjects();

function setup() {
  return {
    env,
    profile,
    projects,
    history: [],
    retriever: Retriever.fromIndexFile(undefined, env),
  };
}

describe("semantic pipeline regressions", () => {
  it.each([
    ["What is Gaurav's best project?", ["appogeny"]],
    ["what are his most prominent projects", ["appogeny", "linzsings", "digital-counterpart"]],
    ["Show me his flagship work.", ["appogeny", "linzsings", "digital-counterpart"]],
    ["What is his strongest robotics project?", ["smart-farm"]],
    ["What project best shows his hardware experience?", ["smart-farm"]],
  ])("uses one ordered project selection for prose and visuals: %s", async (question, expected) => {
    const outcome = await answerPortfolioQuestion({
      ...setup(),
      question,
      complexVerifier: { verify: vi.fn() },
    });
    if (outcome.kind !== "answer") throw new Error("Expected a project answer");
    expect(outcome.answer.visual?.kind).toBe("projects");
    if (outcome.answer.visual?.kind !== "projects") return;
    const visualSlugs = outcome.answer.visual.projects.map(({ slug }) => slug);
    const answerEvidenceSlugs = outcome.answer.assessments
      .flatMap(({ claims }) => claims)
      .flatMap(({ evidenceIds }) => evidenceIds)
      .filter((id) => id.startsWith("evidence:projects/"))
      .map((id) => id.replace("evidence:projects/", ""));
    expect(visualSlugs).toEqual(expected);
    expect(answerEvidenceSlugs).toEqual(expected);
    for (const project of outcome.answer.visual.projects) {
      expect(outcome.answer.text).toContain(project.title);
    }
  });

  it("replays the Appogeny subject through an unsupported architecture question", async () => {
    const history = [
      { id: "u1", role: "user" as const, parts: [{ type: "text" as const, text: "what is appogeny" }] },
      { id: "a1", role: "assistant" as const, parts: [{ type: "text" as const, text: "Supported overview." }] },
      { id: "u2", role: "user" as const, parts: [{ type: "text" as const, text: "what architecture is it built on?" }] },
      { id: "a2", role: "assistant" as const, parts: [{ type: "text" as const, text: "Not recorded." }] },
    ];
    const outcome = await answerPortfolioQuestion({
      ...setup(),
      question: "what is it about?",
      history,
      complexVerifier: { verify: vi.fn() },
    });
    if (outcome.kind !== "answer") throw new Error("Expected a project answer");
    expect(outcome.answer.resolvedQuestion).toBe("what is Appogeny about?");
    expect(outcome.answer.support).toBe("supported");
    expect(outcome.answer.visual).toMatchObject({
      kind: "project-detail",
      project: { slug: "appogeny" },
    });
  });

  it("keeps Appogeny architecture unsupported without losing the subject", async () => {
    const outcome = await answerPortfolioQuestion({
      ...setup(),
      question: "what architecture is it built on?",
      history: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "what is appogeny" }] },
      ],
      complexVerifier: abstainingOfflineVerifier,
    });
    if (outcome.kind !== "answer") throw new Error("Expected an assessed knowledge gap");
    expect(outcome.answer.resolvedQuestion).toBe("what architecture is Appogeny built on?");
    expect(outcome.answer.support).toBe("insufficient");
    expect(outcome.answer.visual).toBeNull();
  });

  it.each([
    ["Where is Gaurav from?", "place of origin"],
    ["Does he live in Austria?", "residence"],
  ])("terminates unsupported geographic relations as canonical absence: %s", async (question, field) => {
    const verifier = { verify: vi.fn() };
    const outcome = await answerPortfolioQuestion({ ...setup(), question, complexVerifier: verifier });
    if (outcome.kind !== "answer") throw new Error("Expected a knowledge-gap answer");
    expect(outcome.answer.support).toBe("not-recorded");
    expect(outcome.answer.text).toBe(`I don't have Gaurav's ${field} recorded.`);
    expect(outcome.answer.citations).toEqual([]);
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it("terminates a high-confidence external question before retrieval or model stages", async () => {
    const base = setup();
    const retrieve = vi.spyOn(base.retriever, "retrieve");
    const verifier = { verify: vi.fn() };
    const renderer = { rewrite: vi.fn(), review: vi.fn() };
    const outcome = await answerPortfolioQuestion({
      ...base,
      question: "What is the capital of France?",
      complexVerifier: verifier,
      naturalAnswerModel: renderer,
    });
    expect(outcome).toMatchObject({
      kind: "local",
      understoodQuery: { domain: "external" },
    });
    expect(retrieve).not.toHaveBeenCalled();
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(renderer.rewrite).not.toHaveBeenCalled();
    expect(renderer.review).not.toHaveBeenCalled();
  });

  it("uses direct-safe presentation for a deterministic exact fact", async () => {
    const renderer = { rewrite: vi.fn(), review: vi.fn() };
    const outcome = await answerPortfolioQuestion({
      ...setup(),
      env: { ...env, naturalAnswers: { ...env.naturalAnswers, enabled: true } },
      question: "Where is Gaurav based?",
      complexVerifier: { verify: vi.fn() },
      naturalAnswerModel: renderer,
    });
    if (outcome.kind !== "answer") throw new Error("Expected an answer");
    expect(outcome.answer).toMatchObject({
      presentation: "direct-safe",
      rendering: "deterministic",
      understoodQuery: {
        domain: "portfolio",
        qualifiers: { locationRelation: "based" },
      },
    });
    expect(renderer.rewrite).not.toHaveBeenCalled();
    expect(renderer.review).not.toHaveBeenCalled();
  });

  it("answers contact-info with canonical channels and keeps message composition distinct", async () => {
    const info = await answerPortfolioQuestion({
      ...setup(),
      question: "How can I contact him?",
      complexVerifier: { verify: vi.fn() },
    });
    if (info.kind !== "answer") throw new Error("Expected contact information");
    expect(info.answer.understoodQuery.interaction.kind).toBe("contact-info");
    expect(info.answer.text).toContain(profile.contact.email);
    expect(info.answer.text).toContain(profile.contact.linkedin);

    const message = await answerPortfolioQuestion({
      ...setup(),
      question: "Can I message him?",
      complexVerifier: { verify: vi.fn() },
    });
    if (message.kind !== "answer") throw new Error("Expected message action");
    expect(message.answer.understoodQuery.interaction.kind).toBe("contact-message");
    expect(message.answer.visual?.kind).toBe("contact-form");
  });

  it("keeps an evidence challenge on the previous trusted user proposition", async () => {
    const outcome = await answerPortfolioQuestion({
      ...setup(),
      question: "source?",
      history: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "Tell me about Udaan." }] },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "Anything at all." }] },
      ],
      complexVerifier: { verify: vi.fn() },
    });
    if (outcome.kind !== "answer") throw new Error("Expected reassessed evidence");
    expect(outcome.answer.resolvedQuestion).toBe("Tell me about Udaan.");
    expect(outcome.answer.understoodQuery).toMatchObject({
      originalQuery: "source?",
      interaction: { kind: "evidence-challenge" },
      target: { kind: "project", id: "udaan" },
    });
    expect(outcome.answer.citations.map(({ evidenceId }) => evidenceId)).toContain("evidence:projects/udaan");
  });

  it("applies bounded response shape only after factual approval", async () => {
    const renderer = { rewrite: vi.fn(), review: vi.fn() };
    const outcome = await answerPortfolioQuestion({
      ...setup(),
      env: { ...env, naturalAnswers: { ...env.naturalAnswers, enabled: true } },
      question: "describe yourself in 3 words",
      naturalAnswerModel: renderer,
      complexVerifier: { verify: vi.fn() },
    });
    if (outcome.kind !== "answer") throw new Error("Expected a shaped answer");
    expect(outcome.answer.text.match(/\b[\w-]+\b/g)).toHaveLength(3);
    expect(outcome.answer.text).toBe("AI, robotics, software.");
    expect(outcome.answer.assessments[0]).toMatchObject({
      status: "supported",
      method: "exact-fact",
      evidenceIds: ["evidence:profile:bio", "evidence:profile:focus"],
    });
    expect(renderer.rewrite).not.toHaveBeenCalled();
  });
});
