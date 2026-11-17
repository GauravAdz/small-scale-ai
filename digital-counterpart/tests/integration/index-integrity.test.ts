import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { EmbeddingFingerprintMismatchError, StaleKnowledgeIndexError } from "@/lib/errors";
import { assertCurrentSources, parseKnowledgeIndex } from "@/lib/knowledge/manifest";
import { readEnv } from "@/lib/config";
import { Retriever } from "@/lib/rag/retriever";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("index integrity", () => {
  it("detects a source change after ingest", () => {
    const index = parseKnowledgeIndex(
      JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/.index/index.json"), "utf8")),
    );
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "counterpart-index-"));
    temporary.push(root);
    const data = path.join(root, "data");
    fs.cpSync(path.join(process.cwd(), "data"), data, {
      recursive: true,
      filter: (source) => !source.includes(`${path.sep}.index`),
    });
    fs.appendFileSync(path.join(data, "profile.json"), "\n");
    expect(() => assertCurrentSources(index, data)).toThrow(StaleKnowledgeIndexError);
  });

  it("rejects a runtime embedding fingerprint mismatch", () => {
    const config = readEnv({
      ...process.env,
      EMBEDDING_PROVIDER: "google",
      EMBEDDING_MODEL: "gemini-embedding-001",
      EMBEDDING_DIMENSIONS: "768",
      VECTOR_STORE: "memory",
    });
    expect(() => Retriever.fromIndexFile(undefined, config)).toThrow(
      EmbeddingFingerprintMismatchError,
    );
  });
});
