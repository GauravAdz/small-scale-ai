import { readEnv, type EnvConfig } from "@/lib/config";
import type { Chunk, VectorStore } from "../types";
import { MemoryVectorStore } from "./memory";
import { PineconeVectorStore } from "./pinecone";
import { SupabaseVectorStore } from "./supabase";
import { ProviderUnavailableError } from "@/lib/errors";

export { MemoryVectorStore, PineconeVectorStore, SupabaseVectorStore };

function required(value: string | undefined, name: string, kind: string): string {
  if (!value) throw new ProviderUnavailableError(`VECTOR_STORE=${kind} requires ${name} to be set.`);
  return value;
}

/**
 * Build the configured store. `chunks` seeds the in-memory backend; remote
 * backends ignore it because their vectors already live server-side.
 */
export function createVectorStore(
  chunks: Chunk[] = [],
  config: EnvConfig = readEnv(),
  indexId = "unscoped",
): VectorStore {
  const { kind, pinecone, supabase } = config.store;

  switch (kind) {
    case "pinecone":
      return new PineconeVectorStore(
        required(pinecone.apiKey, "PINECONE_API_KEY", kind),
        required(pinecone.host, "PINECONE_INDEX_HOST", kind),
        `${pinecone.namespace}-${indexId.slice(0, 16)}`,
        indexId,
      );

    case "supabase":
      return new SupabaseVectorStore(
        required(supabase.url, "SUPABASE_URL", kind),
        required(supabase.serviceKey, "SUPABASE_SERVICE_ROLE_KEY", kind),
        supabase.table,
        indexId,
      );

    case "memory":
      return new MemoryVectorStore(chunks);
  }
}
