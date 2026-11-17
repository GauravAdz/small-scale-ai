/**
 * Pluggable embeddings. Plain `fetch` against each provider's REST endpoint —
 * no SDK, so swapping providers costs a function, not a dependency.
 *
 * Vectors are unit-normalized on the way out, which makes cosine similarity a
 * dot product everywhere downstream.
 */

import { readEnv, type EnvConfig } from "@/lib/config";
import { ProviderUnavailableError, VectorDimensionMismatchError } from "@/lib/errors";
import { canonicalJson, INDEXABLE_TEXT_VERSION, sha256 } from "@/lib/knowledge/manifest";

export type EmbeddingKind = "document" | "query";

export interface Embedder {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number | null;
  embed(texts: string[], kind: EmbeddingKind): Promise<number[][]>;
}

export type EmbeddingFingerprintInput = Readonly<{
  provider: string;
  model: string | null;
  dimensions: number | null;
  normalization: "l2" | "none";
  transform: "mean-centered-v1" | "none";
  indexTextVersion: string;
}>;

export function embeddingFingerprint(input: EmbeddingFingerprintInput): string {
  return sha256(canonicalJson(input));
}

export function embeddingMetadata(config: EnvConfig) {
  const enabled = config.embeddings.provider !== "none";
  const input: EmbeddingFingerprintInput = {
    provider: config.embeddings.provider,
    model: config.embeddings.model,
    dimensions: enabled ? config.embeddings.dimensions : null,
    normalization: enabled ? "l2" : "none",
    transform: enabled ? "mean-centered-v1" : "none",
    indexTextVersion: INDEXABLE_TEXT_VERSION,
  };
  return { ...input, fingerprint: embeddingFingerprint(input) };
}

export function normalize(vector: number[]): number[] {
  let sumOfSquares = 0;
  for (const value of vector) sumOfSquares += value * value;
  const magnitude = Math.sqrt(sumOfSquares);
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

/** Cosine similarity for already-normalized vectors. */
export function dot(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new VectorDimensionMismatchError(a.length, b.length);
  let total = 0;
  for (let i = 0; i < a.length; i++) total += a[i] * b[i];
  return total;
}

/** Component-wise mean of a set of vectors. */
export function meanVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const mean = new Array<number>(vectors[0].length).fill(0);
  for (const vector of vectors) {
    if (vector.length !== mean.length) {
      throw new VectorDimensionMismatchError(mean.length, vector.length);
    }
    for (let i = 0; i < mean.length; i++) mean[i] += vector[i];
  }
  for (let i = 0; i < mean.length; i++) mean[i] /= vectors.length;
  return mean;
}

/**
 * Remove the corpus's shared component, then re-normalize.
 *
 * Both sides of every comparison get this treatment — documents at ingest,
 * queries at retrieval — so the result is still an honest cosine similarity,
 * just one measured after the axis that every vector shares has been taken out.
 * Without it, similarity on this corpus spans 0.78–0.89 and cannot separate a
 * real question from an unrelated one; with it, the range opens up enough to
 * gate on. Standard practice, and free at query time (one subtraction).
 */
export function center(vector: number[], mean: number[] | undefined): number[] {
  if (!mean) return vector;
  if (mean.length !== vector.length) {
    throw new VectorDimensionMismatchError(vector.length, mean.length);
  }
  return normalize(vector.map((value, index) => value - mean[index]));
}

function validateDimensions(vectors: number[][], dimensions: number | null): number[][] {
  if (dimensions === null) return vectors;
  for (const vector of vectors) {
    if (vector.length !== dimensions) {
      throw new VectorDimensionMismatchError(dimensions, vector.length);
    }
  }
  return vectors;
}

async function postJson<T>(url: string, apiKey: string, body: unknown, authHeader = "Authorization"): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [authHeader]: authHeader === "Authorization" ? `Bearer ${apiKey}` : apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Embedding request failed (${response.status}): ${detail.slice(0, 400)}`);
  }

  return (await response.json()) as T;
}

/** Batch to keep request bodies sane; both providers accept arrays. */
async function inBatches<T>(items: string[], size: number, run: (batch: string[]) => Promise<T[]>): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await run(items.slice(i, i + size))));
  }
  return results;
}

function voyageEmbedder(model: string, apiKey: string, dimensions: number | null): Embedder {
  return {
    provider: "voyage",
    model,
    dimensions,
    async embed(texts, kind) {
      return inBatches(texts, 96, async (batch) => {
        const json = await postJson<{ data: Array<{ embedding: number[] }> }>(
          "https://api.voyageai.com/v1/embeddings",
          apiKey,
          { input: batch, model, input_type: kind === "query" ? "query" : "document" },
        );
        return validateDimensions(json.data.map((row) => normalize(row.embedding)), dimensions);
      });
    },
  };
}

function googleEmbedder(model: string, apiKey: string, dimensions: number | null): Embedder {
  // Google's own docs: truncating below the native 3072 dimensions leaves the
  // vector un-normalized, so `normalize()` below isn't optional here.
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${apiKey}`;

  return {
    provider: "google",
    model,
    dimensions,
    async embed(texts, kind) {
      // The API caps batches at 100 requests.
      return inBatches(texts, 100, async (batch) => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: batch.map((text) => ({
              model: `models/${model}`,
              content: { parts: [{ text }] },
              // Gemini embeddings are task-conditioned: asymmetric document vs
              // query encoding measurably improves retrieval.
              taskType: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
              ...(dimensions ? { outputDimensionality: dimensions } : {}),
            })),
          }),
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(
            `Google embedding request failed (${response.status}): ${detail.slice(0, 400)}`,
          );
        }

        const json = (await response.json()) as { embeddings: Array<{ values: number[] }> };
        return validateDimensions(json.embeddings.map((row) => normalize(row.values)), dimensions);
      });
    },
  };
}

function openAiEmbedder(model: string, apiKey: string, dimensions: number | null): Embedder {
  return {
    provider: "openai",
    model,
    dimensions,
    async embed(texts) {
      return inBatches(texts, 128, async (batch) => {
        const json = await postJson<{ data: Array<{ embedding: number[]; index: number }> }>(
          "https://api.openai.com/v1/embeddings",
          apiKey,
          { input: batch, model },
        );
        // OpenAI does not guarantee ordering; sort by index before mapping.
        return validateDimensions([...json.data]
          .sort((a, b) => a.index - b.index)
          .map((row) => normalize(row.embedding)), dimensions);
      });
    },
  };
}

/**
 * Returns `null` when `EMBEDDING_PROVIDER=none`. Callers must treat that as a
 * supported configuration — retrieval degrades to lexical-only, not to broken.
 */
export function createEmbedder(config: EnvConfig = readEnv()): Embedder | null {
  const { provider, model, apiKey, dimensions } = config.embeddings;
  if (provider === "none") return null;

  if (!apiKey) {
    const varName =
      provider === "voyage"
        ? "VOYAGE_API_KEY"
        : provider === "google"
          ? "GOOGLE_GENERATIVE_AI_API_KEY"
          : "OPENAI_API_KEY";
    throw new ProviderUnavailableError(
      `EMBEDDING_PROVIDER=${provider} but ${varName} is not set. ` +
        `Set the key, or use EMBEDDING_PROVIDER=none for lexical-only retrieval.`,
    );
  }

  const resolvedModel = model!;
  switch (provider) {
    case "google":
      return googleEmbedder(resolvedModel, apiKey, dimensions);
    case "voyage":
      return voyageEmbedder(resolvedModel, apiKey, dimensions);
    case "openai":
      return openAiEmbedder(resolvedModel, apiKey, dimensions);
  }
}
