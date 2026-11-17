import { describe, expect, it } from "vitest";

import {
  contactActionIntent,
  isProjectRepositoryFollowUp,
} from "@/lib/chat/intent";
import { interpretInteraction } from "@/lib/chat/interaction-intent";
import { profileLinkVisual } from "@/lib/chat/visual-data";
import { chooseVisual } from "@/lib/chat/visual-intent";
import { loadProjects } from "@/lib/knowledge/loader";

const projects = loadProjects();

describe("direct contact action intent", () => {
  it.each([
    ["How do I contact you?", "info"],
    ["Can I get in touch?", "info"],
    ["I want to message Gaurav.", "message"],
    ["Can I send you a message?", "message"],
    ["Contact Gaurav.", "info"],
    ["Can I message Gaurav about Udaan's repo?", "message"],
  ] as const)("keeps contact action semantics distinct: %s", (question, kind) => {
    expect(contactActionIntent(question, projects)).toEqual({ kind });
    expect(chooseVisual(question)?.kind).toBe("contact-form");
  });

  it.each([
    ["Give me your GitHub link", "github"],
    ["Where is his GitHub?", "github"],
    ["Do you have GitHub?", "github"],
    ["Give me Gaurav's LinkedIn.", "linkedin"],
    ["What is Gaurav’s email?", "email"],
    ["Give me Gaurav's website.", "website"],
    ["Can I download Gaurav's CV?", "resume"],
    ["Resume please", "resume"],
    ["resume", "resume"],
    ["GitHub?", "github"],
  ] as const)("routes a direct channel request to one profile link: %s", (question, channel) => {
    expect(contactActionIntent(question, projects)).toEqual({
      kind: "profile-link",
      channel,
    });
    const visual = chooseVisual(question);
    expect(visual?.kind).toBe("profile-link");
    if (visual?.kind === "profile-link") expect(visual.data.channel).toBe(channel);
  });

  it.each([
    ["linked in pls", "linkedin"],
    ["git hub pls", "github"],
    ["linkedin please", "linkedin"],
    ["git-hub please", "github"],
  ] as const)("keeps normalized answer and visual intent aligned: %s", (question, channel) => {
    expect(contactActionIntent(question, projects)).toEqual({
      kind: "profile-link",
      channel,
    });
    expect(interpretInteraction(question, projects)).toEqual({
      kind: "profile-link",
      target: { kind: "profile" },
      channel,
    });
    const visual = chooseVisual(question);
    expect(visual?.kind).toBe("profile-link");
    if (visual?.kind === "profile-link") expect(visual.data.channel).toBe(channel);
  });

  it.each([
    "Give me the GitHub repo for Udaan.",
    "Where is Udaan's source code?",
    "Show me the Digital Counterpart repo.",
    "Where is Udaan's website?",
    "Which of Gaurav's projects have GitHub repositories?",
    "Show me your GitHub repositories.",
    "GitHub repo?",
    "Give me the git hub repo for Udaan.",
  ])("keeps repository context out of profile-channel intent: %s", (question) => {
    expect(contactActionIntent(question, projects)).toBeNull();
  });

  it("filters repository discovery to projects with authored repo URLs", () => {
    const visual = chooseVisual("Which of Gaurav's projects have GitHub repositories?");
    expect(visual?.kind).toBe("projects");
    if (visual?.kind !== "projects") return;
    expect(visual.projects.length).toBeGreaterThan(0);
    expect(visual.projects.every(({ repo }) => Boolean(repo))).toBe(true);
  });

  it.each([
    "what is a linkedin list in python",
    "git is a version control system right?",
    "What experience is listed in his CV?",
  ])("does not turn nearby technical language into a profile-link visual: %s", (question) => {
    expect(chooseVisual(question)?.kind).not.toBe("profile-link");
  });

  it("builds every profile-link payload from canonical profile data", () => {
    expect(profileLinkVisual("github")).toMatchObject({
      channel: "github",
      value: "@GauravAdz",
      href: "https://github.com/GauravAdz",
      actionLabel: "Open GitHub",
    });
    expect(profileLinkVisual("linkedin")).toMatchObject({
      channel: "linkedin",
      value: "Gaurav Adhikari",
      href: "https://www.linkedin.com/in/gauravadz/",
    });
    expect(profileLinkVisual("email")).toMatchObject({
      channel: "email",
      value: "admin@gauravadhikari.info.np",
      href: "mailto:admin@gauravadhikari.info.np",
    });
    expect(profileLinkVisual("website")).toMatchObject({
      channel: "website",
      value: "gauravadhikari.info.np",
      href: "https://gauravadhikari.info.np",
    });
    expect(profileLinkVisual("resume")).toMatchObject({
      channel: "resume",
      value: "Gaurav Adhikari's CV",
      href: "/resume.pdf",
      actionLabel: "Download CV",
      download: true,
    });
  });

  it("only treats terse repository language as a contextual follow-up", () => {
    expect(isProjectRepositoryFollowUp("GitHub?")).toBe(true);
    expect(isProjectRepositoryFollowUp("Repository link")).toBe(true);
    expect(isProjectRepositoryFollowUp("Which projects are on GitHub?")).toBe(false);
    expect(isProjectRepositoryFollowUp("Give me your GitHub link")).toBe(false);
  });
});
