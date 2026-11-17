import { describe, expect, it } from "vitest";

import {
  interpretInteraction,
  primaryTopicForInteraction,
} from "@/lib/chat/interaction-intent";
import { loadProjects } from "@/lib/knowledge/loader";

const projects = loadProjects().map(({ slug, title }) => ({ slug, title }));

function intent(question: string) {
  return interpretInteraction(question, projects);
}

describe("interaction intent", () => {
  it.each([
    ["Give me your GitHub link", "github"],
    ["Where is his GitHub?", "github"],
    ["Give me Gaurav's LinkedIn.", "linkedin"],
    ["What is Gaurav's email?", "email"],
    ["What is his website?", "website"],
    ["Can I get Gaurav's CV?", "resume"],
    ["Resume please", "resume"],
    ["resume", "resume"],
  ] as const)("maps %s to the requested profile channel", (question, channel) => {
    expect(intent(question)).toEqual({
      kind: "profile-link",
      target: { kind: "profile" },
      channel,
    });
  });

  it("keeps CV content questions on experience instead of the download action", () => {
    for (const [question, kind, target] of [
      ["What experience is listed in his CV?", "experience", "experience"],
      ["Show me the skills in Gaurav's resume.", "skills", "skill"],
    ] as const) {
      const result = intent(question);
      expect(result).toEqual({ kind, target: { kind: target } });
      expect(primaryTopicForInteraction(result)).toBe(kind);
    }
    expect(primaryTopicForInteraction(intent("Resume please"))).toBe("experience");
  });

  it.each([
    ["How can I contact him?", "contact-info"],
    ["Can I send Gaurav a message?", "contact-message"],
    ["I'd like to get in touch with Gaurav.", "contact-info"],
  ] as const)("keeps contact intents distinct: %s", (question, kind) => {
    expect(intent(question)).toEqual({
      kind,
      target: { kind: "profile" },
    });
  });

  it("lets a named project repository beat the profile GitHub channel", () => {
    expect(intent("Give me the GitHub repo for Udaan.")).toEqual({
      kind: "project-link",
      target: { kind: "project", slug: "udaan" },
    });
  });

  it("treats GitHub project discovery as portfolio discovery", () => {
    expect(intent("Which of Gaurav's projects have GitHub repositories?")).toEqual({
      kind: "project-repository-discovery",
      target: { kind: "portfolio" },
    });
  });

  it("keeps named project detail separate from broad project discovery", () => {
    expect(intent("Tell me about Digital Counterpart.")).toEqual({
      kind: "project-detail",
      target: { kind: "project", slug: "digital-counterpart" },
    });
    expect(intent("Show me Gaurav's projects.")).toEqual({
      kind: "projects",
      target: { kind: "portfolio" },
    });
  });

  it("keeps hiring evidence separate from availability", () => {
    expect(intent("Why should we hire Gaurav?").kind).toBe("hiring-evidence");
    expect(intent("Is Gaurav available?").kind).toBe("hiring-availability");
  });

  it.each([
    "his education background",
    "his education background?",
    "Tell me about his educational background.",
    "What is his academic background?",
  ])("lets explicit education language beat generic background: %s", (question) => {
    const result = intent(question);
    expect(result).toEqual({ kind: "education", target: { kind: "education" } });
    expect(primaryTopicForInteraction(result)).toBe("education");
  });

  it.each([
    "Give me the 30-second version of Gaurav's background.",
    "Tell me about his professional background.",
    "What is Gaurav's work experience?",
  ])("keeps genuine experience/background questions on experience: %s", (question) => {
    const result = intent(question);
    expect(result).toEqual({ kind: "experience", target: { kind: "experience" } });
    expect(primaryTopicForInteraction(result)).toBe("experience");
  });
});
