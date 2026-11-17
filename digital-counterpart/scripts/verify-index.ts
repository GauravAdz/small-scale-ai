import fs from "node:fs";
import path from "node:path";

import counterpartConfig from "../counterpart.config";
import { readEnv } from "../src/lib/config";
import { EmbeddingFingerprintMismatchError, KnowledgeSchemaError } from "../src/lib/errors";
import {
  assertCurrentSources,
  CHUNKER_VERSION,
  parseKnowledgeIndex,
  validateIndexReferences,
} from "../src/lib/knowledge/manifest";
import { embeddingMetadata } from "../src/lib/rag/embeddings";

const dataDir = path.join(process.cwd(), "data");
const indexPath = path.join(dataDir, ".index", "index.json");

function verify(): void {
  if (!fs.existsSync(indexPath)) throw new KnowledgeSchemaError(`Missing ${indexPath}.`);
  const index = parseKnowledgeIndex(JSON.parse(fs.readFileSync(indexPath, "utf8")));
  assertCurrentSources(index, dataDir);

  const configured = counterpartConfig.retrieval.chunk;
  if (
    index.chunker.version !== CHUNKER_VERSION ||
    index.chunker.size !== configured.size ||
    index.chunker.overlap !== configured.overlap
  ) {
    throw new KnowledgeSchemaError("Persisted chunk configuration differs from application configuration.");
  }

  const expectedEmbedding = embeddingMetadata(readEnv());
  if (expectedEmbedding.fingerprint !== index.embedding.fingerprint) {
    throw new EmbeddingFingerprintMismatchError(
      `Configured embedding fingerprint ${expectedEmbedding.fingerprint} differs from index ${index.embedding.fingerprint}.`,
    );
  }

  const referenceErrors = validateIndexReferences(index);
  if (referenceErrors.length > 0) throw new KnowledgeSchemaError(referenceErrors.join("\n"));

  if (index.embedding.dimensions !== null) {
    if (index.embedding.mean?.length !== index.embedding.dimensions) {
      throw new KnowledgeSchemaError("Embedding mean does not match persisted dimensions.");
    }
    if (index.store.kind === "memory") {
      for (const chunk of index.chunks) {
        if (chunk.embedding?.length !== index.embedding.dimensions) {
          throw new KnowledgeSchemaError(`Chunk ${chunk.id} has an incompatible embedding dimension.`);
        }
      }
    }
  }

  console.log(
    `Index V2 verified: ${index.evidence.length} evidence records, ${index.chunks.length} chunks, corpus ${index.corpus.digest.slice(0, 12)}.`,
  );
}

try {
  verify();
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exit(1);
}

