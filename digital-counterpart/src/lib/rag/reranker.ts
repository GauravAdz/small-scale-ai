import type { ScoredChunk } from "./types";

export type RerankedChunk = ScoredChunk & { rerankerScore?: number };

export interface Reranker {
  readonly kind: string;
  rerank(query: string, candidates: ScoredChunk[], topK: number): Promise<RerankedChunk[]>;
}

export class NoopReranker implements Reranker {
  readonly kind = "none";

  async rerank(_query: string, candidates: ScoredChunk[], topK: number): Promise<RerankedChunk[]> {
    return candidates.slice(0, topK);
  }
}
