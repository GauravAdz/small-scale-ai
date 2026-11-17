import fs from "node:fs";
import path from "node:path";

import counterpartConfig from "../../../counterpart.config";
import { readEnv, type EnvConfig } from "@/lib/config";
import type { EvidenceRecord } from "@/lib/evidence/types";
import {
  EmbeddingFingerprintMismatchError,
  KnowledgeSchemaError,
  ProviderUnavailableError,
  VectorDimensionMismatchError,
} from "@/lib/errors";
import { INDEX_PATH } from "@/lib/knowledge/loader";
import {
  assertCurrentSources,
  CHUNKER_VERSION,
  parseKnowledgeIndex,
  validateIndexReferences,
} from "@/lib/knowledge/manifest";
import { queryCoverageAcross, scoreLexical, tokenize } from "./bm25";
import { center, createEmbedder, embeddingMetadata, type Embedder } from "./embeddings";
import { retrievalQuery as makeRetrievalQuery, retrievalQuerySchema, type RetrievalQuery } from "./query";
import { NoopReranker, type Reranker } from "./reranker";
import { traced, TRACE_NAMES } from "@/lib/observability/tracing";
import { createVectorStore } from "./store";
import type {
  CandidateRetrieval,
  Chunk,
  Citation,
  KnowledgeIndex,
  RetrievalMode,
  ScoredChunk,
  VectorStore,
} from "./types";
import { RELIABILITY_VERSIONS } from "@/lib/versions";

export const RETRIEVAL_VERSION = RELIABILITY_VERSIONS.retrieval;

function ranks(scores: Map<string, number>): Map<string, number> {
  return new Map(
    [...scores.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([id], index) => [id, index + 1]),
  );
}

function overlap(a: Chunk, b: Chunk): number {
  const left = new Set(tokenize(`${a.title} ${a.headings.join(" ")} ${a.text}`));
  const right = new Set(tokenize(`${b.title} ${b.headings.join(" ")} ${b.text}`));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function selectDiverse(candidates: ScoredChunk[], count: number): ScoredChunk[] {
  const lambda = counterpartConfig.retrieval.diversityLambda;
  const remaining = [...candidates];
  const selected: ScoredChunk[] = [];
  while (selected.length < count && remaining.length > 0) {
    let bestIndex = 0;
    let bestUtility = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index];
      const redundancy = selected.reduce((max, current) => {
        const sameDocument = current.chunk.docId === candidate.chunk.docId ? 0.22 : 0;
        return Math.max(max, Math.min(1, overlap(current.chunk, candidate.chunk) + sameDocument));
      }, 0);
      const utility = lambda * candidate.score - (1 - lambda) * redundancy;
      if (utility > bestUtility) {
        bestUtility = utility;
        bestIndex = index;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected;
}

function validateEmbeddingState(index: KnowledgeIndex, config: EnvConfig): void {
  const expected = embeddingMetadata(config);
  if (index.embedding.fingerprint !== expected.fingerprint) {
    throw new EmbeddingFingerprintMismatchError(
      `Runtime embedding fingerprint ${expected.fingerprint} does not match index ${index.embedding.fingerprint}. Re-run \`npm run ingest\` with the active runtime configuration.`,
    );
  }
  if (index.embedding.transform === "mean-centered-v1") {
    if (!index.embedding.mean || index.embedding.mean.length !== index.embedding.dimensions) {
      throw new KnowledgeSchemaError(
        "Mean-centred embedding metadata is missing a dimensionally valid mean vector.",
      );
    }
  }
  if (index.store.kind === "memory" && index.embedding.dimensions !== null) {
    for (const chunk of index.chunks) {
      if (!chunk.embedding) {
        throw new KnowledgeSchemaError(`Embedded memory index is missing vector ${chunk.id}.`);
      }
      if (chunk.embedding.length !== index.embedding.dimensions) {
        throw new VectorDimensionMismatchError(index.embedding.dimensions, chunk.embedding.length);
      }
    }
  }
}

export class Retriever {
  private semanticRetryAt = 0;

  private constructor(
    private readonly index: KnowledgeIndex,
    private readonly chunksById: ReadonlyMap<string, Chunk>,
    private readonly evidenceById: ReadonlyMap<string, EvidenceRecord>,
    private readonly embedder: Embedder | null,
    private readonly store: VectorStore | null,
    private readonly reranker: Reranker,
    private readonly config: EnvConfig,
  ) {}

  static fromIndexFile(
    indexPath = INDEX_PATH,
    config: EnvConfig = readEnv(),
    reranker?: Reranker,
  ): Retriever {
    if (!fs.existsSync(indexPath)) {
      throw new KnowledgeSchemaError(`No knowledge index at ${indexPath}. Run \`npm run ingest\`.`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    } catch (error) {
      throw new KnowledgeSchemaError(`Knowledge index is not valid JSON: ${String(error)}`);
    }
    const parsed = parseKnowledgeIndex(raw);
    const index = parsed as KnowledgeIndex;
    const dataDir = path.dirname(path.dirname(indexPath));
    assertCurrentSources(parsed, dataDir);
    if (
      index.chunker.version !== CHUNKER_VERSION ||
      index.chunker.size !== counterpartConfig.retrieval.chunk.size ||
      index.chunker.overlap !== counterpartConfig.retrieval.chunk.overlap
    ) {
      throw new KnowledgeSchemaError("Runtime chunk configuration does not match the persisted index.");
    }
    const referenceErrors = validateIndexReferences(parsed);
    if (referenceErrors.length > 0) throw new KnowledgeSchemaError(referenceErrors.join("\n"));
    if (index.store.kind !== config.store.kind) {
      throw new KnowledgeSchemaError(
        `Runtime vector store ${config.store.kind} does not match index store ${index.store.kind}.`,
      );
    }
    validateEmbeddingState(index, config);

    const activeReranker = reranker ?? new NoopReranker();
    if (activeReranker.kind !== config.features.reranker.kind) {
      throw new ProviderUnavailableError(
        `RERANKER=${config.features.reranker.kind} is configured, but the active adapter is ${activeReranker.kind}. Run the held-out retrieval evaluation before injecting a provider adapter.`,
      );
    }

    const chunksById = new Map(index.chunks.map((chunk) => [chunk.id, chunk]));
    const evidenceById = new Map(index.evidence.map((record) => [record.id, record]));
    const embedder = index.embedding.provider === "none" ? null : createEmbedder(config);
    const store = embedder
      ? createVectorStore(index.chunks, config, index.store.indexId)
      : null;
    return new Retriever(index, chunksById, evidenceById, embedder, store, activeReranker, config);
  }

  get stats() {
    return {
      chunks: this.index.chunks.length,
      evidence: this.index.evidence.length,
      builtAt: this.index.builtAt,
      indexDigest: this.index.corpus.digest,
      embedding: this.index.embedding,
      store: this.index.store,
      mode: this.embedder ? ("hybrid" as const) : ("lexical" as const),
    };
  }

  evidence(ids: readonly string[]): EvidenceRecord[] {
    return ids.flatMap((id) => {
      const record = this.evidenceById.get(id);
      return record ? [record] : [];
    });
  }

  allEvidence(): readonly EvidenceRecord[] {
    return this.index.evidence;
  }

  async retrieve(input: RetrievalQuery | string, topK?: number): Promise<CandidateRetrieval> {
    const query =
      typeof input === "string" ? makeRetrievalQuery(input) : retrievalQuerySchema.parse(input);
    const k = topK ?? counterpartConfig.retrieval.candidateK;
    if (!query.expanded) {
      return {
        query,
        candidates: [],
        diagnostics: {
          mode: "lexical",
          topScore: 0,
          semanticTop: 0,
          lexicalQueryCoverage: 0,
          lexicalScores: {},
          semanticScores: {},
          fusedScores: {},
        },
      };
    }

    const lexical = scoreLexical(query.expanded, this.index.chunks, this.index.lexical);
    const semantic = new Map<string, number>();
    let semanticTop = 0;
    let mode: RetrievalMode = "lexical";
    let fallbackReason: string | undefined;

    if (this.embedder && this.store && Date.now() >= this.semanticRetryAt) {
      try {
        const [raw] = await this.embedder.embed([query.expanded], "query");
        const embedding = center(raw, this.index.embedding.mean);
        for (const match of await this.store.query(embedding, k * 3)) {
          if (!this.chunksById.has(match.id)) continue;
          semantic.set(match.id, match.score);
          semanticTop = Math.max(semanticTop, match.score);
        }
        mode = lexical.size > 0 ? "hybrid" : "semantic";
      } catch (error) {
        if (error instanceof VectorDimensionMismatchError) throw error;
        fallbackReason = error instanceof Error ? error.name : "semantic-provider-unavailable";
        console.error("[retriever] semantic candidates unavailable", { error_class: fallbackReason });
        this.semanticRetryAt = Date.now() + 5 * 60 * 1000;
      }
    }

    const { lexical: configuredLex, semantic: configuredVec } = counterpartConfig.retrieval.weights;
    const lexicalRanks = ranks(lexical);
    const semanticRanks = ranks(semantic);
    const activeLex = lexical.size > 0 ? configuredLex : 0;
    const activeVec = semantic.size > 0 ? configuredVec : 0;
    const activeTotal = activeLex + activeVec || 1;
    const wLex = activeLex / activeTotal;
    const wVec = activeVec / activeTotal;
    const perfect = (wLex + wVec) / (counterpartConfig.retrieval.rankFusionK + 1);
    const fused = new Map<string, ScoredChunk>();

    for (const id of new Set([...lexical.keys(), ...semantic.keys()])) {
      const chunk = this.chunksById.get(id);
      if (!chunk) continue;
      const lexicalScore = lexical.get(id) ?? 0;
      const semanticScore = semantic.get(id) ?? 0;
      const rankScore =
        (lexicalRanks.has(id)
          ? wLex / (counterpartConfig.retrieval.rankFusionK + lexicalRanks.get(id)!)
          : 0) +
        (semanticRanks.has(id)
          ? wVec / (counterpartConfig.retrieval.rankFusionK + semanticRanks.get(id)!)
          : 0);
      const prior = 0.9 + (chunk.weight / 100) * 0.2;
      // Normalise the authored prior by its maximum. Capping after applying an
      // unnormalised boost flattened several high-ranked candidates to 1.0,
      // leaving MMR to break meaningful ties by corpus insertion order.
      const normalizedPrior = prior / 1.1;
      fused.set(id, {
        chunk,
        score: Math.min(1, (perfect > 0 ? rankScore / perfect : 0) * normalizedPrior),
        lexicalScore,
        semanticScore,
      });
    }

    const discovered = [...fused.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(k * 4, k));
    const reranked = await traced(
      this.config,
      TRACE_NAMES.reranking,
      {
        reranker_kind: this.reranker.kind,
        candidate_count: discovered.length,
        index_digest: this.index.corpus.digest,
      },
      () => this.reranker.rerank(query.original, discovered, Math.max(k * 2, k)),
    );
    const candidates = selectDiverse(reranked, k);
    const lexicalQueryCoverage = queryCoverageAcross(
      query.original,
      candidates.map(({ chunk }) => chunk),
      this.index.lexical,
    );

    return {
      query,
      candidates,
      diagnostics: {
        mode: semantic.size > 0 ? mode : "lexical",
        topScore: candidates[0]?.score ?? 0,
        semanticTop,
        lexicalQueryCoverage,
        lexicalScores: Object.fromEntries(lexical),
        semanticScores: Object.fromEntries(semantic),
        fusedScores: Object.fromEntries([...fused].map(([id, scored]) => [id, scored.score])),
        ...(fallbackReason ? { fallbackReason } : {}),
      },
    };
  }
}

/** Controlled JSON data for verifier calls. Evidence text is never prompt instructions. */
export function formatContext(result: CandidateRetrieval): string {
  return JSON.stringify(
    result.candidates.map(({ chunk }) => ({
      evidenceIds: chunk.evidenceIds,
      source: chunk.source,
      heading: chunk.headings,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text,
    })),
  );
}

/** Retrieval-source overview only. Claim citations are built from verified claims. */
export function toCitations(result: CandidateRetrieval): Citation[] {
  const seen = new Map<string, Citation>();
  for (const { chunk, score } of result.candidates) {
    const existing = seen.get(chunk.docId);
    if (existing && (existing.score ?? 0) >= score) continue;
    seen.set(chunk.docId, {
      id: chunk.docId,
      evidenceId: chunk.evidenceIds[0],
      title: chunk.title,
      source: chunk.source,
      section: chunk.headings.at(-1),
      excerpt: chunk.text,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      url: chunk.url,
      score: Number(score.toFixed(3)),
    });
  }
  return [...seen.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

export function getRetriever(): Retriever {
  // The corpus is tiny. Revalidating its manifest per request is cheap and
  // avoids a warm process serving a cached index after mounted source data has
  // changed. Any future cache must be keyed by corpus digest and fingerprint.
  return Retriever.fromIndexFile();
}
