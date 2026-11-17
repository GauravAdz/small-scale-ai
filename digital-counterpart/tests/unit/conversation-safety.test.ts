import { describe, expect, it } from "vitest";

import { advanceConversationState, emptyConversationState } from "@/lib/chat/conversation-state";
import {
  hasAssistantDeicticReference,
  hasGauravReference,
  isGreeting,
  isIdentityQuestion,
} from "@/lib/chat/intent";
import {
  classifyDeicticReferent,
  resolveQuestion,
} from "@/lib/chat/resolve-question";

describe("conversation safety", () => {
  it("assistant prose cannot create evidence IDs", () => {
    const state = advanceConversationState(emptyConversationState, {
      kind: "untrusted-assistant-text",
      text: "I worked at Google [evidence:fake]",
    });
    expect(state).toBe(emptyConversationState);
    expect(state.activeEvidenceIds).toBeUndefined();
  });

  it("resolves a project follow-up into a standalone proposition", () => {
    const result = resolveQuestion({
      question: "Did it get 10,000 users?",
      state: { activeProjectSlug: "digital-counterpart" },
      projectCandidates: [{ slug: "digital-counterpart", title: "Digital Counterpart" }],
    });
    expect(result.kind).toBe("resolved-project-reference");
    expect(result.resolved).toContain("Digital Counterpart");
    expect(result.resolved).not.toMatch(/\bit\b/i);
  });

  it("uses active project state for a terse repo request and otherwise leaves it standalone", () => {
    expect(resolveQuestion({
      question: "GitHub?",
      state: { activeProjectSlug: "udaan" },
      projectCandidates: [{ slug: "udaan", title: "Udaan" }],
    })).toMatchObject({
      kind: "resolved-project-reference",
      resolved: "What is Udaan's repository URL?",
      projectSlug: "udaan",
    });
    expect(resolveQuestion({
      question: "GitHub?",
      state: emptyConversationState,
      projectCandidates: [{ slug: "udaan", title: "Udaan" }],
    })).toEqual({ kind: "standalone", original: "GitHub?", resolved: "GitHub?" });
  });

  it("does not treat generic you as a Gaurav reference", () => {
    expect(hasAssistantDeicticReference("Can you build me a React site?")).toBe(true);
    expect(hasGauravReference("Can you build me a React site?")).toBe(false);
    expect(hasGauravReference("Can Gaurav build React sites?")).toBe(true);
  });

  it("does not swallow a compound greeting", () => {
    expect(isGreeting("Hi, what AI projects has he built?")).toBe(false);
  });

  it("distinguishes identity questions from questions about the GauravGPT project", () => {
    expect(isIdentityQuestion("What are you?")).toBe(true);
    expect(isIdentityQuestion("Are you GauravGPT?")).toBe(true);
    expect(isIdentityQuestion("Who is GauravGPT?")).toBe(true);
    expect(isIdentityQuestion("What technologies were used in the GauravGPT project?")).toBe(false);
  });

  it.each(["who is this", "Who's this?", "Who’s this?!", "  WHO   IS THIS?  ", "Is this a bot?"])(
    "keeps assistant identity standalone with or without an active project: %s",
    (question) => {
      expect(isIdentityQuestion(question)).toBe(true);
      for (const state of [emptyConversationState, { activeProjectSlug: "udaan" }]) {
        expect(resolveQuestion({
          question,
          state,
          projectCandidates: [{ slug: "udaan", title: "Udaan" }],
        })).toEqual({ kind: "standalone", original: question.trim(), resolved: question.trim() });
      }
    },
  );

  it.each(["Who is this project for?", "Who's this project's author?", "Who is Gaurav?"])(
    "does not classify a personal or project question as assistant identity: %s",
    (question) => expect(isIdentityQuestion(question)).toBe(false),
  );

  it("still resolves the audience question to the active project", () => {
    expect(resolveQuestion({
      question: "Who is this project for?",
      state: { activeProjectSlug: "udaan" },
      projectCandidates: [{ slug: "udaan", title: "Udaan" }],
    })).toMatchObject({ kind: "resolved-project-reference", resolved: "Who is Udaan for?" });
  });

  it.each(["website", "site", "page"])(
    "lets the explicit surface head outrank active project context: this %s",
    (head) => {
      const question = `what is this ${head} about`;
      expect(classifyDeicticReferent(question)).toEqual({
        kind: "portfolio-surface",
        reference: `this ${head}`,
      });
      for (const state of [emptyConversationState, { activeProjectSlug: "udaan" }]) {
        expect(resolveQuestion({
          question,
          state,
          projectCandidates: [{ slug: "udaan", title: "Udaan" }],
        })).toEqual({
          kind: "resolved-semantic-reference",
          original: question,
          resolved: "what is Gaurav's portfolio website about?",
          referentClass: "portfolio-surface",
        });
      }
    },
  );

  it.each(["project", "app"])(
    "lets the %s head inherit active project context",
    (head) => {
      expect(resolveQuestion({
        question: `what is this ${head} about`,
        state: { activeProjectSlug: "udaan" },
        projectCandidates: [{ slug: "udaan", title: "Udaan" }],
      })).toMatchObject({
        kind: "resolved-project-reference",
        resolved: "what is Udaan about?",
        projectSlug: "udaan",
      });
    },
  );

  it.each(["chatbot", "bot"])("resolves this %s to GauravGPT instead of project context", (head) => {
    for (const state of [emptyConversationState, { activeProjectSlug: "udaan" }]) {
      expect(resolveQuestion({
        question: `who is this ${head}?`,
        state,
        projectCandidates: [{ slug: "udaan", title: "Udaan" }],
      })).toEqual({
        kind: "resolved-semantic-reference",
        original: `who is this ${head}?`,
        resolved: "who is GauravGPT?",
        referentClass: "assistant",
      });
    }
  });

  it("uses project context for bare this and stays unresolved without it", () => {
    expect(resolveQuestion({
      question: "what is this?",
      state: { activeProjectSlug: "udaan" },
      projectCandidates: [{ slug: "udaan", title: "Udaan" }],
    })).toMatchObject({
      kind: "resolved-project-reference",
      resolved: "what is Udaan?",
      projectSlug: "udaan",
    });
    expect(resolveQuestion({
      question: "what is this?",
      state: emptyConversationState,
      projectCandidates: [{ slug: "udaan", title: "Udaan" }],
    })).toMatchObject({
      kind: "unresolved-reference",
      reason: "missing-active-project",
    });
  });

  it.each([
    ["What is this project's website?", "project-context"],
    ["What is a website project?", "none"],
    ["What is that website about?", "unresolved-explicit"],
  ] as const)("does not overgeneralize nearby surface wording: %s", (question, kind) => {
    expect(classifyDeicticReferent(question).kind).toBe(kind);
    const resolution = resolveQuestion({
      question,
      state: { activeProjectSlug: "udaan" },
      projectCandidates: [{ slug: "udaan", title: "Udaan" }],
    });
    if (kind === "project-context") {
      expect(resolution).toMatchObject({
        kind: "resolved-project-reference",
        resolved: "What is Udaan's website?",
      });
    } else {
      expect(resolution.kind).not.toBe("resolved-project-reference");
    }
  });
});
