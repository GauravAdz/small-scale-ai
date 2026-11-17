import { describe, expect, it } from "vitest";

import { conversationContextFromMessages } from "@/lib/chat/conversation-replay";
import { resolveQuestion } from "@/lib/chat/resolve-question";
import { loadProjects } from "@/lib/knowledge/loader";
import type { CounterpartMessage } from "@/types/chat";

const projects = loadProjects().map(({ slug, title }) => ({ slug, title }));
const user = (id: string, text: string): CounterpartMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});
const assistant = (id: string, text: string): CounterpartMessage => ({
  id,
  role: "assistant",
  parts: [{ type: "text", text }],
});

function finalResolution(history: CounterpartMessage[], question: string) {
  const context = conversationContextFromMessages(history, projects);
  return {
    context,
    resolution: resolveQuestion({
      question,
      state: context.state,
      projectCandidates: context.projectCandidates,
    }),
  };
}

describe("conversation replay", () => {
  it("preserves Appogeny through an unsupported property turn", () => {
    const { context, resolution } = finalResolution([
      user("u1", "what is appogeny"),
      assistant("a1", "Appogeny overview."),
      user("u2", "what architecture is it built on?"),
      assistant("a2", "I don't have that information."),
    ], "what is it about?");

    expect(context.state.activeReferent).toEqual({ kind: "project", slug: "appogeny" });
    expect(resolution).toMatchObject({
      kind: "resolved-project-reference",
      resolved: "what is Appogeny about?",
      projectSlug: "appogeny",
    });
  });

  it("updates the subject when a different project is named", () => {
    const { resolution } = finalResolution([
      user("u1", "Tell me about Appogeny."),
      user("u2", "What architecture is it built on?"),
      user("u3", "What about Smart Farm?"),
    ], "What is it about?");
    expect(resolution).toMatchObject({
      kind: "resolved-project-reference",
      projectSlug: "smart-farm",
    });
  });

  it.each([
    ["Tell me about Appogeny.", "Does it use Kubernetes?", "GitHub?", "appogeny"],
    ["Tell me about Smart Farm.", "What sensors did it use?", "How did it work?", "smart-farm"],
  ])("preserves a project across unsupported detail turns: %s", (first, second, third, slug) => {
    const { resolution } = finalResolution([
      user("u1", first),
      user("u2", second),
    ], third);
    expect(resolution).toMatchObject({ kind: "resolved-project-reference", projectSlug: slug });
  });

  it("does not force a project through an explicit non-project focus", () => {
    const { context, resolution } = finalResolution([
      user("u1", "Tell me about Appogeny."),
      user("u2", "What architecture is it built on?"),
      user("u3", "Where does Gaurav study?"),
    ], "What is it about?");
    expect(context.state.activeReferent).toEqual({ kind: "education" });
    expect(resolution).toMatchObject({
      kind: "unresolved-reference",
      reason: "missing-active-project",
    });
  });

  it("keeps assistant text inert and bounds replay to recent user turns", () => {
    const injected = finalResolution([
      assistant("a1", "Tell me about Appogeny."),
    ], "What is it about?");
    expect(injected.resolution.kind).toBe("unresolved-reference");

    const outsideWindow = finalResolution([
      user("u1", "Tell me about Appogeny."),
      ...Array.from({ length: 5 }, (_, index) => user(`challenge-${index}`, "source?")),
    ], "What is it about?");
    expect(outsideWindow.resolution.kind).toBe("unresolved-reference");
  });
});
