/**
 * Supabase pgvector via PostgREST — no `@supabase/supabase-js` dependency.
 *
 * Apply `supabase/migrations/0001_init.sql` first: it creates the table, the
 * ivfflat index, and the `match_counterpart_documents` RPC this class calls.
 */

import type { Chunk, VectorStore } from "../types";

export class SupabaseVectorStore implements VectorStore {
  readonly kind = "supabase";

  constructor(
    private readonly url: string,
    private readonly serviceKey: string,
    private readonly table: string,
    private readonly indexId: string,
  ) {}

  private get headers() {
    return {
      apikey: this.serviceKey,
      Authorization: `Bearer ${this.serviceKey}`,
      "Content-Type": "application/json",
    };
  }

  private base(path: string): string {
    return `${this.url.replace(/\/$/, "")}${path}`;
  }

  private async assertOk(response: Response, label: string): Promise<void> {
    if (response.ok) return;
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase ${label} failed (${response.status}): ${detail.slice(0, 400)}`);
  }

  async upsert(chunks: Chunk[]): Promise<void> {
    const embedded = chunks.filter((chunk) => chunk.embedding?.length);
    if (embedded.length === 0) {
      throw new Error(
        "VECTOR_STORE=supabase requires embeddings. Set EMBEDDING_PROVIDER to voyage or openai.",
      );
    }

    for (let i = 0; i < embedded.length; i += 100) {
      const batch = embedded.slice(i, i + 100);
      const response = await fetch(this.base(`/rest/v1/${this.table}`), {
        method: "POST",
        headers: { ...this.headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(
          batch.map((chunk) => ({
            id: `${this.indexId}:${chunk.id}`,
            chunk_id: chunk.id,
            index_id: this.indexId,
            doc_id: chunk.docId,
            title: chunk.title,
            type: chunk.type,
            source: chunk.source,
            content: chunk.text,
            embedding: chunk.embedding,
          })),
        ),
      });
      await this.assertOk(response, "upsert");
    }
  }

  async reset(): Promise<void> {
    const response = await fetch(
      this.base(`/rest/v1/${this.table}?index_id=eq.${encodeURIComponent(this.indexId)}`),
      {
      method: "DELETE",
      headers: { ...this.headers, Prefer: "return=minimal" },
      },
    );
    await this.assertOk(response, "reset");
  }

  async query(embedding: number[], topK: number): Promise<Array<{ id: string; score: number }>> {
    const response = await fetch(this.base("/rest/v1/rpc/match_counterpart_documents"), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        query_embedding: embedding,
        match_count: topK,
        active_index_id: this.indexId,
      }),
    });
    await this.assertOk(response, "query");

    const rows = (await response.json()) as Array<{ id: string; similarity: number }>;
    // The RPC returns `1 - cosine_distance`, already in [0, 1].
    return rows.map((row) => ({ id: row.id, score: row.similarity }));
  }
}
