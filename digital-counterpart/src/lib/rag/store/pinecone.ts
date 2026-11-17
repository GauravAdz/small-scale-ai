/**
 * Pinecone serverless over REST — no SDK dependency.
 *
 * Requires PINECONE_API_KEY and PINECONE_INDEX_HOST (the per-index host shown in
 * the console, e.g. https://my-index-abc123.svc.us-east-1-aws.pinecone.io).
 */

import type { Chunk, VectorStore } from "../types";

const API_VERSION = "2025-04";

export class PineconeVectorStore implements VectorStore {
  readonly kind = "pinecone";

  constructor(
    private readonly apiKey: string,
    private readonly host: string,
    private readonly namespace: string,
    private readonly indexId: string,
  ) {}

  private async request<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.host.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        "Api-Key": this.apiKey,
        "Content-Type": "application/json",
        "X-Pinecone-API-Version": API_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Pinecone ${path} failed (${response.status}): ${detail.slice(0, 400)}`);
    }

    return (await response.json()) as T;
  }

  async upsert(chunks: Chunk[]): Promise<void> {
    const embedded = chunks.filter((chunk) => chunk.embedding?.length);
    if (embedded.length === 0) {
      throw new Error(
        "VECTOR_STORE=pinecone requires embeddings. Set EMBEDDING_PROVIDER to voyage or openai.",
      );
    }

    // Pinecone caps upsert payloads; 100 vectors per call stays well inside it.
    for (let i = 0; i < embedded.length; i += 100) {
      const batch = embedded.slice(i, i + 100);
      await this.request("/vectors/upsert", {
        namespace: this.namespace,
        vectors: batch.map((chunk) => ({
          id: chunk.id,
          values: chunk.embedding,
          // Text stays in the local index file; metadata here is for debugging
          // in the Pinecone console and for any out-of-band tooling.
          metadata: {
            indexId: this.indexId,
            docId: chunk.docId,
            title: chunk.title,
            type: chunk.type,
            source: chunk.source,
          },
        })),
      });
    }
  }

  async reset(): Promise<void> {
    await this.request("/vectors/delete", { namespace: this.namespace, deleteAll: true });
  }

  async query(embedding: number[], topK: number): Promise<Array<{ id: string; score: number }>> {
    const json = await this.request<{ matches?: Array<{ id: string; score: number }> }>(
      "/query",
      { namespace: this.namespace, vector: embedding, topK, includeValues: false },
    );

    // Assumes the index uses the cosine metric, which yields scores in [-1, 1].
    return (json.matches ?? []).map((match) => ({
      id: match.id,
      score: (match.score + 1) / 2,
    }));
  }
}
