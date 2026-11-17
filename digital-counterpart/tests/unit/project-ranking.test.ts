import { describe, expect, it } from "vitest";

import { loadProjects } from "@/lib/knowledge/loader";
import {
  rankProjectsForQuestion,
  selectProjectsForQuestion,
} from "@/lib/evidence/project-ranking";

const projects = loadProjects();

function selected(question: string): string[] {
  return selectProjectsForQuestion(question, projects)?.projects.map(({ slug }) => slug) ?? [];
}

describe("project ranking", () => {
  it("uses canonical authored order when the question has no technical constraint", () => {
    expect(projects.slice(0, 3).map(({ slug }) => slug)).toEqual([
      "appogeny",
      "linzsings",
      "digital-counterpart",
    ]);
    const ranked = rankProjectsForQuestion("what are his most prominent projects", projects);
    expect(ranked.every(({ relevanceScore }) => relevanceScore === 0)).toBe(true);
    expect(ranked.slice(0, 3).map(({ project }) => project.slug)).toEqual([
      "appogeny",
      "linzsings",
      "digital-counterpart",
    ]);
  });

  it.each([
    ["What is Gaurav's best project?", ["appogeny"]],
    ["What is his strongest project?", ["appogeny"]],
    ["what are his most prominent projects", ["appogeny", "linzsings", "digital-counterpart"]],
    ["Show me his flagship work.", ["appogeny", "linzsings", "digital-counterpart"]],
  ])("selects editorial work for %s", (question, expected) => {
    expect(selected(question)).toEqual(expected);
  });

  it.each([
    ["What is his strongest robotics project?", "smart-farm"],
    ["What project best shows his hardware experience?", "smart-farm"],
    ["What project best demonstrates IoT?", "smart-farm"],
    ["What project best demonstrates RAG?", "digital-counterpart"],
  ])("lets a meaningful constraint beat editorial order for %s", (question, expected) => {
    expect(selected(question)[0]).toBe(expected);
  });

  it("does not let the generic word project create relevance", () => {
    const ranked = rankProjectsForQuestion("Which project should I look at first?", projects);
    expect(ranked.every(({ reasons }) => reasons.every((reason) => reason !== "matches project")))
      .toBe(true);
    expect(ranked[0].project.slug).toBe("appogeny");
  });
});
