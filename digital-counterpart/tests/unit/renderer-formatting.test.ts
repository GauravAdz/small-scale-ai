import { describe, expect, it } from "vitest";

import type { FactualAnswerPlan } from "@/lib/llm/answer-plan";
import { renderFactualPlan } from "@/lib/llm/renderer";

function plan(texts: Array<{ text: string; kind?: "fact" | "inference" | "uncertainty" }>): FactualAnswerPlan {
  return {
    clauses: texts.map(({ text, kind = "fact" }, index) => ({
      questionId: `q${index}`,
      status: kind === "uncertainty" ? "insufficient" : "supported",
      claims: [{ id: `c${index}`, text, kind, evidenceIds: kind === "uncertainty" ? [] : [`e${index}`] }],
    })),
  };
}

describe("deterministic response formatting", () => {
  it("keeps one claim as prose", async () => {
    expect(await renderFactualPlan(plan([{ text: "Gaurav is based in Linz, Austria." }]))).toBe(
      "Gaurav is based in Linz, Austria.",
    );
  });

  it("wraps three approved claims in Markdown bullets without changing them", async () => {
    const texts = [
      "Gaurav taught integrated science.",
      "He mentored robotics students.",
      "He builds independent AI products.",
    ];
    const rendered = await renderFactualPlan(plan(texts.map((text) => ({ text }))));
    expect(rendered).toBe(texts.map((text) => `- ${text}`).join("\n"));
    for (const text of texts) expect(rendered).toContain(text);
  });

  it("preserves uncertainty, inference labels, URLs, numbers, and skill levels", async () => {
    const texts = [
      "I don't have enough verified information to answer that confidently.",
      "Based on the project records, this appears relevant.",
      "Python is listed at the Experienced level; see https://example.com and 20 users.",
    ];
    const rendered = await renderFactualPlan(plan([
      { text: texts[0], kind: "uncertainty" },
      { text: texts[1], kind: "inference" },
      { text: texts[2] },
    ]));
    expect(rendered).toBe(texts.map((text) => `- ${text}`).join("\n"));
  });

  it("uses compact bullets for brief mode without dropping claims", async () => {
    expect(await renderFactualPlan(plan([{ text: "First fact." }, { text: "Second fact." }]), { mode: "brief" }))
      .toBe("- First fact.\n- Second fact.");
  });

  it("keeps sentence mode to one sentence", async () => {
    expect(await renderFactualPlan(plan([{ text: "First fact." }, { text: "Second fact." }]), { mode: "sentence" }))
      .toBe("First fact; Second fact.");
  });

  it("uses an already-approved keyword claim and otherwise falls back safely", async () => {
    expect(await renderFactualPlan(plan([{ text: "AI, robotics, software." }]), { mode: "keywords", count: 3 }))
      .toBe("AI, robotics, software.");
    expect(await renderFactualPlan(plan([{ text: "Gaurav is based in Linz, Austria." }]), { mode: "keywords", count: 3 }))
      .toBe("Gaurav is based in Linz, Austria.");
  });
});
