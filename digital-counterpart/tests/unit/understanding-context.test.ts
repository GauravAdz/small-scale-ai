import { describe, expect, it } from "vitest";
import { Retriever } from "@/lib/rag/retriever";
import { retrievalQuery } from "@/lib/rag/query";
import { selectUnderstandingEvidence } from "@/lib/rag/verification-context";
import counterpartConfig from "../../counterpart.config";

describe("bounded evidence for semantic understanding", () => {
  it("includes authored records even when lexical retrieval finds nothing", async () => {
    const retriever = Retriever.fromIndexFile();
    const retrieval = await retriever.retrieve(retrievalQuery("zzzzzzzz"), 10);
    expect(retrieval.candidates).toEqual([]);
    const evidence = selectUnderstandingEvidence(
      retrieval,
      retriever.allEvidence(),
      counterpartConfig.retrieval.verificationK,
      counterpartConfig.retrieval.verificationMaxCharacters,
    );
    expect(evidence.map(({ id }) => id)).toEqual(expect.arrayContaining([
      "evidence:projects/smart-farm", "evidence:profile:skills", "evidence:philosophy", "evidence:experience",
    ]));
    expect(evidence.every(({ id, docId }) => id === `evidence:${docId}`)).toBe(true);
    expect(evidence.some(({ text }) => /\bTODO\b/.test(text))).toBe(false);
  });

  it("falls back to ranked excerpts and enforces record and character limits", async () => {
    const retriever = Retriever.fromIndexFile();
    const retrieval = await retriever.retrieve(retrievalQuery("project architecture"), 10);
    for (const [count, characters] of [[3, 24_000], [20, 900], [0, 900], [20, 0]]) {
      const evidence = selectUnderstandingEvidence(retrieval, retriever.allEvidence(), count, characters);
      expect(evidence.length).toBeLessThanOrEqual(count);
      expect(evidence.reduce((sum, record) => sum + record.text.length, 0)).toBeLessThanOrEqual(characters);
      expect(evidence.every(({ id }) => id.includes("#"))).toBe(true);
      for (const record of evidence) expect(retriever.allEvidence()).toContainEqual(record);
    }
  });
});
