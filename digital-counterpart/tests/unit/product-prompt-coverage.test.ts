import { describe, expect, it } from "vitest";

import counterpartConfig from "../../counterpart.config";
import { loadEvalCases } from "@/lib/evals/dataset";

describe("product-authored prompt coverage", () => {
  it("keeps every nonlocal landing prompt in the evaluation dataset", () => {
    const configured = new Set([
      ...counterpartConfig.chat.intro.topics.map(({ prompt }) => prompt),
      ...counterpartConfig.chat.quickPrompts
        .filter(({ localVisual }) => !localVisual)
        .map(({ prompt }) => prompt),
    ]);
    const covered = new Set(
      loadEvalCases()
        .filter(({ tags }) => tags.includes("product-prompt"))
        .map(({ question }) => question),
    );

    expect([...configured].filter((prompt) => !covered.has(prompt))).toEqual([]);
  });
});
