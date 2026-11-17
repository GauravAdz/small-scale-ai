import { getCache } from "@vercel/functions";

export interface AnswerCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

/** Shared across visitors in one process, with bounded size and TTL. */
export class MemoryAnswerCache implements AnswerCache {
  private readonly entries = new Map<string, { value: unknown; expires: number }>();
  constructor(private readonly options: { ttlMs: number; maxEntries: number }, private readonly now = Date.now) {}
  async get(key: string): Promise<unknown> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= this.now()) return undefined;
    this.entries.set(key, entry);
    return structuredClone(entry.value);
  }
  async set(key: string, value: unknown): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, { value: structuredClone(value), expires: this.now() + this.options.ttlMs });
    while (this.entries.size > this.options.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }
}

/** The Vercel cache is shared across instances in the same project/env/region. */
class RegionalAnswerCache implements AnswerCache {
  // Keys already contain SHA-256; preserve them instead of the SDK's 32-bit hash.
  private readonly remote = getCache({ namespace: "counterpart-natural-answers", keyHashFunction: (key) => key });
  constructor(private readonly ttlMs: number) {}
  async get(key: string): Promise<unknown> { return this.remote.get(key); }
  async set(key: string, value: unknown): Promise<void> {
    await this.remote.set(key, value, { ttl: Math.ceil(this.ttlMs / 1000), tags: ["counterpart-natural-answers"] });
  }
}

let shared: { identity: string; cache: AnswerCache } | undefined;
export function sharedAnswerCache(options: { ttlMs: number; maxEntries: number }): AnswerCache {
  const regional = process.env.VERCEL === "1";
  const identity = JSON.stringify({ ...options, regional });
  if (!shared || shared.identity !== identity) {
    shared = { identity, cache: regional ? new RegionalAnswerCache(options.ttlMs) : new MemoryAnswerCache(options) };
  }
  return shared.cache;
}
