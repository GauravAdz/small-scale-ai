import { describe, expect, it } from "vitest";

import { normalizeExactFactLookup } from "@/lib/evidence/exact-facts";

describe("exact fact lookup normalization", () => {
  it.each([
    ["does gaurav do works related ai", "does gaurav do work related ai"],
    ["Is Gaurav working on AI projects?", "Is Gaurav work on AI projects?"],
  ])("normalizes harmless work inflections: %s", (input, expected) => {
    expect(normalizeExactFactLookup(input)).toBe(expected);
  });

  it.each([
    "are you gpt-5.4-luna",
    "Are you GPT 5.6 Luna?",
    "is GauravGPT an LLM?",
  ])("routes runtime model identity deterministically: %s", (input) => {
    expect(normalizeExactFactLookup(input)).toBe("what model are you");
  });

  it.each([
    "are you llm from open ai",
    "Is this AI model from OpenAI?",
  ])("routes runtime provider identity deterministically: %s", (input) => {
    expect(normalizeExactFactLookup(input)).toBe("who powers you model");
  });

  it.each([
    ["linked in pls", "linkedin pls"],
    ["git hub pls", "github pls"],
    ["git-hub please", "github please"],
  ])("normalizes contact channel spelling for exact lookup: %s", (input, expected) => {
    expect(normalizeExactFactLookup(input)).toBe(expected);
  });

  it("does not turn an unrelated work domain into an AI fact", () => {
    expect(normalizeExactFactLookup("does gaurav do works related accounting"))
      .toBe("does gaurav do work related accounting");
  });
});
