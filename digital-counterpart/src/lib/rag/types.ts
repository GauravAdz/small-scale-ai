/** Shared shapes for the retrieval pipeline. */

/** A source document before chunking. */
export type KnowledgeDoc = {
  /** Stable id — `projects/gauravgpt` or `profile:bio`. */
  id: string;
  title: string;
  type: string;
  /** Path relative to `data/`, or a synthetic label for profile-derived docs. */
  source: string;
  slug?: string;
  weight: number;
  url?: string;
  text: string;
  /** Filled by ingest after hashing the canonical source bytes. */
  sourceHash?: string;
  evidenceIds?: string[];
};

/** A retrievable unit. */
export type Chunk = {
  id: string;
  docId: string;
  title: string;
  type: string;
  source: string;
  url?: string;
  weight: number;
  /** Heading trail within the document, e.g. ["GauravGPT", "How it works"]. */
  headings: string[];
  text: string;
  sourceHash: string;
  evidenceIds: string[];
  startLine?: number;
  endLine?: number;
  /** Present only when an embedding provider is configured. Unit-normalized. */
  embedding?: number[];
};

/** Corpus-level statistics needed for BM25 at query time. */
export type LexicalStats = {
  /** term -> number of chunks containing it */
  documentFrequency: Record<string, number>;
  /** chunk id -> token count */
  lengths: Record<string, number>;
  averageLength: number;
  totalChunks: number;
};

/** What `npm run ingest` writes to `data/.index/index.json`. */
export type KnowledgeIndexV2 = {
  version: 2;
  builtAt: string;
  corpus: {
    digest: string;
    sources: Array<{ path: string; sha256: string; size: number }>;
  };
  chunker: { version: string; size: number; overlap: number };
  embedding: {
    provider: string;
    model: string | null;
    dimensions: number | null;
    normalization: "l2" | "none";
    transform: "mean-centered-v1" | "none";
    fingerprint: string;
    /**
     * Mean of the corpus's document vectors, before centering.
     *
     * Embedding spaces are anisotropic: every vector shares a large common
     * component, so raw cosine similarity is squashed into a narrow band near
     * the top — on this corpus, everything from "what AI projects has he built"
     * to "explain quantum mechanics" landed between 0.78 and 0.89. That band is
     * fine for *ranking* and useless as an absolute "is this even about him"
     * signal, which is exactly what the scope guard needs.
     *
     * Subtracting the mean from both sides removes the shared component and
     * restores the range. Stored here so query vectors can be centered the same
     * way the document vectors already were at ingest.
     */
    mean?: number[];
  };
  store: { kind: string; indexId: string };
  evidence: import("@/lib/evidence/types").EvidenceRecord[];
  chunks: Chunk[];
  lexical: LexicalStats;
};

export type KnowledgeIndex = KnowledgeIndexV2;

/** A chunk plus why it was retrieved. */
export type ScoredChunk = {
  chunk: Chunk;
  score: number;
  lexicalScore: number;
  semanticScore: number;
};

export type RetrievalMode = "hybrid" | "lexical" | "semantic";

/** Candidate selection output. None of these diagnostics establish factual support. */
export type CandidateRetrieval = {
  query: import("./query").RetrievalQuery;
  candidates: ScoredChunk[];
  diagnostics: {
    mode: RetrievalMode;
    topScore: number;
    semanticTop: number;
    lexicalQueryCoverage: number;
    lexicalScores: Record<string, number>;
    semanticScores: Record<string, number>;
    fusedScores: Record<string, number>;
    fallbackReason?: string;
  };
};

/** @deprecated Use CandidateRetrieval; retained as a source-compatible type alias. */
export type RetrievalResult = CandidateRetrieval;

/** What the UI renders under an answer. */
export type Citation = {
  id: string;
  claimId?: string;
  evidenceId?: string;
  claimText?: string;
  title: string;
  source: string;
  section?: string;
  headingPath?: readonly string[];
  excerpt?: string;
  startLine?: number;
  endLine?: number;
  jsonPointer?: string;
  url?: string;
  score?: number;
  provenance?: "portfolio-record" | "runtime-record" | "repository-record";
};

/** Minimal contract every vector backend implements. */
export interface VectorStore {
  readonly kind: string;
  /** Replace the stored vectors with exactly these. Called by ingest. */
  upsert(chunks: Chunk[]): Promise<void>;
  /** Nearest neighbours by cosine similarity. Scores normalized to 0..1. */
  query(embedding: number[], topK: number): Promise<Array<{ id: string; score: number }>>;
  /** Drop everything. Called by ingest before a rebuild. */
  reset?(): Promise<void>;
}
