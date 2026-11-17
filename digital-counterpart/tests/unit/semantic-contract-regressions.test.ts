import { describe, expect, it, vi } from "vitest";

import { conversationContextFromMessages } from "@/lib/chat/conversation-replay";
import { emptyConversationState } from "@/lib/chat/conversation-state";
import { interpretInteraction } from "@/lib/chat/interaction-intent";
import {
  deterministicUnderstoodQuery,
  type UnderstoodQuery,
} from "@/lib/chat/query-understanding";
import { resolveQuestion } from "@/lib/chat/resolve-question";
import { answerExactFact } from "@/lib/evidence/exact-facts";
import { createFactStore } from "@/lib/evidence/fact-store";
import { decomposeQuestion } from "@/lib/evidence/question";
import { readEnv } from "@/lib/config";
import { loadProfile, loadProjects } from "@/lib/knowledge/loader";
import { Retriever } from "@/lib/rag/retriever";

const env = readEnv({ NODE_ENV: "test" });
const profile = loadProfile();
const projects = loadProjects();
const projectRefs = projects.map(({ slug, title }) => ({ slug, title }));
const institutions = profile.education.map(({ school }) => school);
const retriever = Retriever.fromIndexFile(undefined, env);
const store = createFactStore({
  profile,
  projects,
  evidence: retriever.allEvidence(),
  env,
});

function understood(query: string): UnderstoodQuery {
  return deterministicUnderstoodQuery({
    originalQuery: query,
    resolvedQuery: query,
    projects: projectRefs,
    institutions,
  });
}

function exact(query: string) {
  const clause = decomposeQuestion(query)[0];
  return answerExactFact(clause, store, understood(query));
}

describe("typed semantic contract regressions", () => {
  it.each([
    ["When was Gaurav born?", "13 July 2005"],
    ["What is his date of birth?", "13 July 2005"],
    ["Where was Gaurav born?", "Nepal"],
    ["What is his citizenship?", "Nepalese citizen"],
  ])("answers authored biographical facts: %s", (question, text) => {
    expect(exact(question)?.status).toBe("supported");
    expect(exact(question)?.claims[0].text).toContain(text);
  });

  it.each(["Was Gaurav born in Austria?", "Was Gaurav born in Kathmandu?", "Is Gaurav an Austrian citizen?"])("assesses qualified biography questions semantically: %s", (question) => {
    expect(exact(question)).toBeNull();
  });

  it("binds a named school before deterministic education lookup", () => {
    const query = understood("Tell me about Budhanilkantha School.");
    expect(query).toMatchObject({
      domain: "portfolio",
      interaction: { kind: "education" },
      target: { kind: "education" },
      qualifiers: { institution: "Budhanilkantha School" },
    });

    const decision = exact("Tell me about Budhanilkantha School.");
    expect(decision).toMatchObject({
      status: "supported",
      method: "exact-fact",
      evidenceIds: ["evidence:profile:education"],
    });
    expect(decision?.claims[0].text).toContain("Budhanilkantha School");
    expect(decision?.claims[0].text).not.toContain("Johannes Kepler University Linz");
  });

  it("does not substitute current study details for a different or unknown institution", () => {
    expect(exact("Tell me about Stanford University.")).toBeNull();
    expect(exact("What made you choose that kind of studies?")).toBeNull();
  });

  it("keeps a broad education summary exact without consuming a named-school query", () => {
    expect(exact("his education background")?.claims[0].text)
      .toContain("Johannes Kepler University Linz");
    expect(understood("Is Gaurav studying at JKU?").qualifiers.institution)
      .toBe("Johannes Kepler University Linz");
    expect(exact("Is Gaurav studying at JKU?")?.claims[0].text)
      .toContain("Johannes Kepler University Linz");
  });

  it.each([
    ["Where are you based?", "based", "supported"],
    ["Where is Gaurav currently located?", "based", "supported"],
    ["Where do you live?", "lives", "not-recorded"],
    ["Where are you from?", "from", "not-recorded"],
    ["What is Gaurav's origin?", "origin", "not-recorded"],
    ["What is Gaurav's nationality?", "nationality", "supported"],
    ["Where was Gaurav born?", "birthplace", "supported"],
  ] as const)("preserves the location relation in %s", (question, relation, status) => {
    expect(understood(question).qualifiers.locationRelation).toBe(relation);
    const decision = exact(question);
    expect(decision?.status).toBe(status);
  });

  it("does not treat the evidentiary phrase 'based on' as a location relation", () => {
    const question = "Based on his documented work, does an applied-AI product role appear aligned?";
    expect(understood(question).qualifiers.locationRelation).toBeUndefined();
    expect(exact(question)?.claims[0]).toMatchObject({ kind: "inference" });
  });

  it.each([
    "Should I hire Gaurav?",
    "Is Gaurav hireable?",
    "Would Gaurav be worth interviewing?",
    "Would he be a good fit?",
    "Would he add value?",
    "What would he contribute?",
    "Why should I hire him?",
  ])("models hiring evidence independently from availability: %s", (question) => {
    expect(interpretInteraction(question, projectRefs).kind).toBe("hiring-evidence");
  });

  it.each([
    "Is Gaurav available?",
    "Is he open to internships?",
    "Is he looking for opportunities?",
  ])("keeps availability questions separate: %s", (question) => {
    expect(interpretInteraction(question, projectRefs).kind).toBe("hiring-availability");
  });

  it("does not exactly approve a task-specific hiring capability", () => {
    expect(exact("I want to hire someone to build a mobile app. Would he be able to make one?"))
      .toBeNull();
  });

  it.each([
    ["How can I contact him?", "contact-info", undefined],
    ["What is Gaurav's email?", "profile-link", "email"],
    ["LinkedIn please", "profile-link", "linkedin"],
    ["Can I download Gaurav's CV?", "profile-link", "resume"],
    ["Can I message him?", "contact-message", undefined],
  ] as const)("separates contact semantics for %s", (question, kind, channel) => {
    expect(interpretInteraction(question, projectRefs)).toMatchObject({
      kind,
      ...(channel ? { channel } : {}),
    });
  });

  it.each([
    "really?",
    "are you sure?",
    "source?",
    "prove it",
    "is that accurate?",
    "how do you know?",
  ])("resolves an evidence challenge to the previous user proposition: %s", (challenge) => {
    const context = conversationContextFromMessages([
      { id: "u1", role: "user", parts: [{ type: "text", text: "Tell me about Udaan." }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Untrusted assistant prose." }] },
    ], projectRefs);
    const resolution = resolveQuestion({
      question: challenge,
      state: context.state,
      projectCandidates: context.projectCandidates,
    });
    expect(resolution).toMatchObject({
      kind: "resolved-evidence-challenge",
      original: challenge,
      resolved: "Tell me about Udaan.",
      challengedProposition: "Tell me about Udaan.",
    });
  });

  it("lets an explicit education head supersede stale project context", () => {
    const context = conversationContextFromMessages([
      { id: "u1", role: "user", parts: [{ type: "text", text: "Tell me about Udaan." }] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "What are you studying?" }] },
    ], projectRefs);
    expect(context.state.activeReferent).toMatchObject({ kind: "education" });
    expect(resolveQuestion({
      question: "What made you choose that kind of studies?",
      state: context.state,
      projectCandidates: context.projectCandidates,
    })).toMatchObject({
      kind: "standalone",
      resolved: "What made you choose that kind of studies?",
    });
  });

  it("extracts bounded response-shape metadata without changing the proposition", () => {
    const query = understood("describe yourself in 3 words");
    expect(query.originalQuery).toBe("describe yourself in 3 words");
    expect(query.canonicalQuery).toBe("describe yourself in 3 words");
    expect(query.responseShape).toEqual({ mode: "keywords", count: 3 });
  });

  it("marks a clearly unrelated general question external", () => {
    const query = understood("What is the capital of France?");
    expect(query.domain).toBe("external");
    expect(query.interaction.kind).toBe("unknown");
  });
});
