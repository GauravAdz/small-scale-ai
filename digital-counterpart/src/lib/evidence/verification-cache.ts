import type { SupportAssessment } from "./support";

export type CachedVerification = SupportAssessment;
export type CacheOptions = { ttlMs?: number };
export interface VerificationCache {
  get(key: string): Promise<CachedVerification | null>;
  set(key: string, value: CachedVerification, options?: CacheOptions): Promise<void>;
}

/** Process-local LRU. Correctness never depends on a warm process or cache availability. */
export class InMemoryVerificationCache implements VerificationCache {
  private readonly entries = new Map<string, { value: CachedVerification; expiresAt: number }>();
  constructor(
    private readonly options: { ttlMs: number; maxEntries: number },
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries <= 0 ||
        !Number.isFinite(options.ttlMs) || options.ttlMs <= 0) throw new Error("Invalid verification cache limits.");
  }

  async get(key: string): Promise<CachedVerification | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    if (entry.expiresAt <= this.now()) return null;
    this.entries.set(key, entry);
    return structuredClone(entry.value);
  }

  async set(key: string, value: CachedVerification, options?: CacheOptions): Promise<void> {
    const ttlMs = options?.ttlMs ?? this.options.ttlMs;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Invalid verification cache TTL.");
    for (const [id, entry] of this.entries) if (entry.expiresAt <= this.now()) this.entries.delete(id);
    this.entries.delete(key);
    this.entries.set(key, { value: structuredClone(value), expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.options.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }
}

let shared: { config: string; cache: VerificationCache } | undefined;
export function sharedVerificationCache(options: { ttlMs: number; maxEntries: number }): VerificationCache {
  const config = JSON.stringify(options);
  if (!shared || shared.config !== config) shared = { config, cache: new InMemoryVerificationCache(options) };
  return shared.cache;
}
