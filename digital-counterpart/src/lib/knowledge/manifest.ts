import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { evidenceRecordSchema } from "@/lib/evidence/schema";
import { KnowledgeSchemaError, StaleKnowledgeIndexError } from "@/lib/errors";
import { RELIABILITY_VERSIONS } from "@/lib/versions";
import { containsAuthoringPlaceholder } from "./placeholders";

export const CHUNKER_VERSION = RELIABILITY_VERSIONS.chunker;
export const INDEXABLE_TEXT_VERSION = RELIABILITY_VERSIONS.indexableText;

export type SourceManifestEntry = Readonly<{ path: string; sha256: string; size: number }>;

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function sourceFiles(dataDir: string): string[] {
  const visit = (directory: string): string[] =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name.startsWith(".")) return [];
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return visit(full);
      if (!entry.isFile()) return [];
      return entry.name === "profile.json" || entry.name.endsWith(".md") ? [full] : [];
    });
  return visit(dataDir).sort();
}

export function buildSourceManifest(dataDir: string): SourceManifestEntry[] {
  return sourceFiles(dataDir).map((absolutePath) => {
    const bytes = fs.readFileSync(absolutePath);
    return {
      path: `data/${path.relative(dataDir, absolutePath).replace(/\\/g, "/")}`,
      sha256: sha256(bytes),
      size: bytes.byteLength,
    };
  });
}

export function corpusDigest(sources: readonly SourceManifestEntry[]): string {
  return sha256(canonicalJson([...sources].sort((a, b) => a.path.localeCompare(b.path))));
}

const sourceManifestSchema = z.object({
  path: z.string().startsWith("data/"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().nonnegative(),
});

const chunkSchema = z.object({
  id: z.string().min(1),
  docId: z.string().min(1),
  title: z.string(),
  type: z.string(),
  source: z.string().min(1),
  url: z.string().optional(),
  weight: z.number(),
  headings: z.array(z.string()),
  text: z.string(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  evidenceIds: z.array(z.string().min(1)).min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  embedding: z.array(z.number()).optional(),
});

const lexicalStatsSchema = z.object({
  documentFrequency: z.record(z.string(), z.number().int().nonnegative()),
  lengths: z.record(z.string(), z.number().int().nonnegative()),
  averageLength: z.number().nonnegative(),
  totalChunks: z.number().int().nonnegative(),
});

export const knowledgeIndexV2Schema = z.object({
  version: z.literal(2),
  builtAt: z.string().datetime({ offset: true }),
  corpus: z.object({
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    sources: z.array(sourceManifestSchema),
  }),
  chunker: z.object({
    version: z.string().min(1),
    size: z.number().int().positive(),
    overlap: z.number().int().nonnegative(),
  }),
  embedding: z.object({
    provider: z.string().min(1),
    model: z.string().nullable(),
    dimensions: z.number().int().positive().nullable(),
    normalization: z.enum(["l2", "none"]),
    transform: z.enum(["mean-centered-v1", "none"]),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    mean: z.array(z.number()).optional(),
  }),
  store: z.object({ kind: z.string().min(1), indexId: z.string().min(1) }),
  evidence: z.array(evidenceRecordSchema),
  chunks: z.array(chunkSchema),
  lexical: lexicalStatsSchema,
});

export type ParsedKnowledgeIndexV2 = z.infer<typeof knowledgeIndexV2Schema>;

export function parseKnowledgeIndex(input: unknown): ParsedKnowledgeIndexV2 {
  const parsed = knowledgeIndexV2Schema.safeParse(input);
  if (!parsed.success) {
    throw new KnowledgeSchemaError(`Knowledge index V2 is invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function assertCurrentSources(
  index: Pick<ParsedKnowledgeIndexV2, "corpus">,
  dataDir: string,
): void {
  const current = buildSourceManifest(dataDir);
  const digest = corpusDigest(current);
  if (digest !== index.corpus.digest || canonicalJson(current) !== canonicalJson(index.corpus.sources)) {
    throw new StaleKnowledgeIndexError(
      "Knowledge sources differ from the persisted index. Run `npm run ingest` before serving answers.",
    );
  }
}

export function validateIndexReferences(index: ParsedKnowledgeIndexV2): string[] {
  const errors: string[] = [];
  const sourceHashes = new Map(index.corpus.sources.map((source) => [source.path, source.sha256]));
  const evidenceById = new Map(index.evidence.map((record) => [record.id, record]));
  if (evidenceById.size !== index.evidence.length) errors.push("Evidence IDs must be unique");
  if (new Set(index.chunks.map(({ id }) => id)).size !== index.chunks.length) {
    errors.push("Chunk IDs must be unique");
  }
  for (const record of index.evidence) {
    if (containsAuthoringPlaceholder(record)) errors.push(`Evidence ${record.id} contains authoring placeholders`);
    if (!sourceHashes.has(record.locator.source)) {
      errors.push(`Evidence ${record.id} references unknown source ${record.locator.source}`);
    } else if (sourceHashes.get(record.locator.source) !== record.sourceHash) {
      errors.push(`Evidence ${record.id} source hash differs from its source manifest`);
    }
  }
  for (const chunk of index.chunks) {
    if (containsAuthoringPlaceholder([chunk.text, chunk.title, chunk.headings])) {
      errors.push(`Chunk ${chunk.id} contains authoring placeholders`);
    }
    if (!sourceHashes.has(chunk.source)) errors.push(`Chunk ${chunk.id} references unknown source ${chunk.source}`);
    else if (sourceHashes.get(chunk.source) !== chunk.sourceHash) {
      errors.push(`Chunk ${chunk.id} source hash differs from its source manifest`);
    }
    for (const evidenceId of chunk.evidenceIds) {
      if (!evidenceById.has(evidenceId)) errors.push(`Chunk ${chunk.id} references unknown evidence ${evidenceId}`);
    }
  }
  return errors;
}
