import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DeterministicVoiceRenderer } from "@/lib/llm/renderer";

describe("renderer properties", () => {
  it("only emits approved claim text and preserves exact values", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1 }).filter((text) => text.trim().length > 0), { minLength: 1, maxLength: 8 }),
        async (texts) => {
          const output = await new DeterministicVoiceRenderer().render({
            clauses: texts.map((text, index) => ({
              questionId: `q${index}`,
              status: "supported" as const,
              claims: [{ id: `c${index}`, text, kind: "fact" as const, evidenceIds: [`e${index}`] }],
            })),
          });
          expect(output).toBe(texts.map((text) => text.trim()).join(" "));
        },
      ),
    );
  });
});
