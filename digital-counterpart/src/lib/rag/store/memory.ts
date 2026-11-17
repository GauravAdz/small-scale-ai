/**
 * In-process vector store.
 *
 * Vectors live inside `data/.index/index.json` alongside the chunks, so there is
 * no separate persistence step and no service to run. For a corpus measured in
 * hundreds of chunks a linear scan is microseconds — a vector database here
 * would be infrastructure you maintain for no measurable gain.
 */

import { dot } from "../embeddings";
import type { Chunk, VectorStore } from "../types";

export class MemoryVectorStore implements VectorStore {
  readonly kind = "memory";
  private vectors: Array<{ id: string; embedding: number[] }> = [];

  constructor(chunks: Chunk[] = []) {
    this.load(chunks);
  }

  /** Point the store at a set of already-embedded chunks. */
  load(chunks: Chunk[]): void {
    this.vectors = chunks
      .filter((chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length > 0)
      .map((chunk) => ({ id: chunk.id, embedding: chunk.embedding! }));
  }

  async upsert(chunks: Chunk[]): Promise<void> {
    // Ingest persists embeddings inside the index file itself, so "upsert" is
    // just refreshing what this instance holds.
    this.load(chunks);
  }

  async reset(): Promise<void> {
    this.vectors = [];
  }

  async query(embedding: number[], topK: number): Promise<Array<{ id: string; score: number }>> {
    if (this.vectors.length === 0) return [];

    const scored = this.vectors.map((entry) => ({
      id: entry.id,
      // Vectors are unit-normalized at embed time, so this is cosine similarity
      // in [-1, 1]. Rescale to [0, 1] to match the other stores' contract.
      score: (dot(embedding, entry.embedding) + 1) / 2,
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}
