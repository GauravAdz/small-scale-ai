/**
 * `npm run ingest`
 *
 * data/ ──▶ load ──▶ chunk ──▶ embed (optional) ──▶ BM25 stats ──▶ index.json
 *                                    └──▶ remote vector store (optional)
 *
 * Idempotent: safe to run on every content edit. Re-run after changing
 * EMBEDDING_PROVIDER or VECTOR_STORE.
 */

import fs from "node:fs";
import path from "node:path";

import counterpartConfig from "../counterpart.config";
import { readEnv } from "../src/lib/config";
import { evidenceFromChunks, evidenceFromDocuments } from "../src/lib/evidence/records";
import { chunkAll } from "../src/lib/knowledge/chunk";
import { loadKnowledgeDocs } from "../src/lib/knowledge/loader";
import { containsAuthoringPlaceholder } from "../src/lib/knowledge/placeholders";
import {
  buildSourceManifest,
  canonicalJson,
  CHUNKER_VERSION,
  corpusDigest,
  sha256,
} from "../src/lib/knowledge/manifest";
import { buildLexicalStats, indexableText } from "../src/lib/rag/bm25";
import {
  center,
  createEmbedder,
  embeddingMetadata,
  meanVector,
} from "../src/lib/rag/embeddings";
import { createVectorStore } from "../src/lib/rag/store";
import type { KnowledgeIndex } from "../src/lib/rag/types";

const DATA_DIR = path.join(process.cwd(), "data");
const INDEX_DIR = path.join(DATA_DIR, ".index");
const INDEX_FILE = path.join(INDEX_DIR, "index.json");

const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;
const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;

function reportStats(): void {
  if (!fs.existsSync(INDEX_FILE)) {
    console.log(yellow("No index yet. Run `npm run ingest`."));
    return;
  }

  const index = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")) as KnowledgeIndex;
  const byType = index.chunks.reduce<Record<string, number>>((acc, chunk) => {
    acc[chunk.type] = (acc[chunk.type] ?? 0) + 1;
    return acc;
  }, {});

  console.log(bold("\nKnowledge index"));
  console.log(`  built      ${index.builtAt}`);
  console.log(`  chunks     ${index.chunks.length}`);
  console.log(`  embedding  ${index.embedding.provider}${index.embedding.model ? ` (${index.embedding.model}, ${index.embedding.dimensions}d)` : ""}`);
  console.log(`  store      ${index.store.kind} (${index.store.indexId.slice(0, 12)})`);
  console.log(`  vocabulary ${Object.keys(index.lexical.documentFrequency).length} terms`);
  console.log(bold("\n  by type"));
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type.padEnd(12)} ${count}`);
  }
  console.log();
}

async function ingest(): Promise<void> {
  const started = Date.now();
  const env = readEnv();

  console.log(bold("\n▸ Digital Counterpart — ingest\n"));

  // 1. Load ────────────────────────────────────────────────────────────────
  const sources = buildSourceManifest(DATA_DIR);
  const digest = corpusDigest(sources);
  const hashes = new Map(sources.map((source) => [source.path, source.sha256]));
  const docs = loadKnowledgeDocs(DATA_DIR).map((doc) => {
    const sourceHash = hashes.get(doc.source);
    if (!sourceHash) throw new Error(`No source manifest entry for ${doc.source}.`);
    return { ...doc, sourceHash, evidenceIds: [`evidence:${doc.id}`] };
  });
  if (docs.length === 0) {
    throw new Error(`No documents found in ${DATA_DIR}.`);
  }
  console.log(`  ${green("✓")} loaded ${bold(String(docs.length))} documents`);

  const authoringSources = sources.filter((source) =>
    containsAuthoringPlaceholder(fs.readFileSync(path.join(process.cwd(), source.path), "utf8")),
  );
  if (authoringSources.length) console.log(`  ${yellow("!")} excluded authoring content from ${authoringSources.length} source files; missing facts remain missing`);

  // 2. Chunk ───────────────────────────────────────────────────────────────
  const chunks = chunkAll(docs, counterpartConfig.retrieval.chunk);
  const documentEvidence = evidenceFromDocuments(docs);
  const chunkEvidence = evidenceFromChunks(chunks, documentEvidence);
  for (const chunk of chunks) {
    // The precise excerpt is first so narrative verification cites it. The
    // parent stays linked for exhaustive source and retrieval evaluations.
    chunk.evidenceIds = [`evidence:${chunk.id}`, `evidence:${chunk.docId}`];
  }
  const evidence = [...documentEvidence, ...chunkEvidence];
  if (containsAuthoringPlaceholder(evidence) || containsAuthoringPlaceholder(chunks)) {
    throw new Error("Authoring placeholders must never enter the knowledge index.");
  }
  const averageChars = Math.round(
    chunks.reduce((sum, chunk) => sum + chunk.text.length, 0) / Math.max(1, chunks.length),
  );
  console.log(
    `  ${green("✓")} chunked into ${bold(String(chunks.length))} pieces ${dim(`(~${averageChars} chars avg)`)}`,
  );

  // 3. Embed ───────────────────────────────────────────────────────────────
  const embedder = createEmbedder(env);
  const configuredEmbedding = embeddingMetadata(env);
  let dimensions: number | null = null;
  let mean: number[] | null = null;

  if (embedder) {
    process.stdout.write(dim(`  … embedding via ${embedder.provider}/${embedder.model}`));
    const vectors = await embedder.embed(chunks.map(indexableText), "document");
    dimensions = vectors[0]?.length ?? null;
    if (dimensions !== configuredEmbedding.dimensions) {
      throw new Error(
        `Embedding provider returned ${dimensions ?? "no"} dimensions; configured fingerprint expects ${configuredEmbedding.dimensions}.`,
      );
    }

    // Take out the component every vector in this corpus shares, so cosine
    // similarity spans a usable range instead of bunching up near the top.
    // The mean is stored in the index and applied to query vectors too — see
    // `KnowledgeIndex.embedding.mean`.
    mean = meanVector(vectors);
    chunks.forEach((chunk, i) => {
      chunk.embedding = center(vectors[i], mean ?? undefined);
    });

    process.stdout.write("\r\x1b[K");
    console.log(
      `  ${green("✓")} embedded ${bold(String(vectors.length))} chunks ${dim(`(${dimensions}d, mean-centred)`)}`,
    );
  } else {
    console.log(
      `  ${dim("·")} embeddings skipped ${dim("(EMBEDDING_PROVIDER=none → BM25 lexical retrieval)")}`,
    );
  }

  // 4. Lexical stats ───────────────────────────────────────────────────────
  const lexical = buildLexicalStats(chunks);
  console.log(
    `  ${green("✓")} BM25 index over ${bold(String(Object.keys(lexical.documentFrequency).length))} terms`,
  );

  const indexId = sha256(
    canonicalJson({
      corpusDigest: digest,
      embeddingFingerprint: configuredEmbedding.fingerprint,
      chunker: { version: CHUNKER_VERSION, ...counterpartConfig.retrieval.chunk },
    }),
  );

  // 5. Remote store ────────────────────────────────────────────────────────
  if (env.store.kind !== "memory") {
    if (!embedder) {
      throw new Error(
        `VECTOR_STORE=${env.store.kind} needs vectors. Set EMBEDDING_PROVIDER to voyage or openai, or use VECTOR_STORE=memory.`,
      );
    }
    const store = createVectorStore(chunks, env, indexId);
    process.stdout.write(dim(`  … upserting to ${store.kind}`));
    await store.reset?.();
    await store.upsert(chunks);
    process.stdout.write("\r\x1b[K");
    console.log(`  ${green("✓")} upserted to ${bold(store.kind)}`);
  }

  // 6. Write index ─────────────────────────────────────────────────────────
  // Remote stores own the vectors; keeping a second copy on disk would let the
  // two drift apart silently.
  const persistEmbeddings = env.store.kind === "memory";

  const index: KnowledgeIndex = {
    version: 2,
    builtAt: new Date().toISOString(),
    corpus: { digest, sources },
    chunker: { version: CHUNKER_VERSION, ...counterpartConfig.retrieval.chunk },
    embedding: {
      provider: configuredEmbedding.provider,
      model: configuredEmbedding.model,
      dimensions,
      normalization: configuredEmbedding.normalization,
      transform: configuredEmbedding.transform,
      fingerprint: configuredEmbedding.fingerprint,
      ...(mean ? { mean } : {}),
    },
    store: { kind: env.store.kind, indexId },
    evidence,
    chunks: persistEmbeddings
      ? chunks
      : chunks.map(({ embedding: _embedding, ...rest }) => rest),
    lexical,
  };

  fs.mkdirSync(INDEX_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index), "utf8");

  const sizeKb = (fs.statSync(INDEX_FILE).size / 1024).toFixed(1);
  console.log(
    `  ${green("✓")} wrote ${bold("data/.index/index.json")} ${dim(`(${sizeKb} KB)`)}`,
  );
  console.log(green(`\n  Done in ${((Date.now() - started) / 1000).toFixed(2)}s\n`));
}

const main = process.argv.includes("--stats")
  ? async () => reportStats()
  : ingest;

main().catch((error: unknown) => {
  console.error(`\n\x1b[31m✗ ingest failed\x1b[0m\n`);
  console.error(error instanceof Error ? error.message : error);
  console.error();
  process.exit(1);
});
