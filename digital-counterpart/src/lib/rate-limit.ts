/**
 * Rate limiting for the public chat endpoint.
 *
 * `/api/chat` is unauthenticated and every call spends real model quota, so an
 * unguarded endpoint means one script can drain a day's free tier in a minute —
 * leaving the site dead exactly when it matters.
 *
 * Two backends behind one interface, same pattern as the vector stores:
 *
 *   memory  (default) — a counter per instance. On serverless each instance has
 *                       its own map, so the effective limit is `limit × warm
 *                       instances`. That is leaky in principle and adequate in
 *                       practice for a personal site: a single abuser is
 *                       usually pinned to one warm instance, and the cap still
 *                       bounds the damage. No setup, no dependency.
 *   upstash           — a shared counter in Redis over REST, so the limit holds
 *                       across instances. Correct, and free-tier friendly.
 */

import type { EnvConfig } from "@/lib/config";

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Epoch ms when the current window expires. */
  resetAt: number;
};

export interface RateLimiter {
  readonly kind: string;
  check(key: string): Promise<RateLimitResult>;
}

/** Never blocks. Used when rate limiting is switched off. */
class NoopLimiter implements RateLimiter {
  readonly kind = "disabled";
  async check(): Promise<RateLimitResult> {
    return { ok: true, limit: Infinity, remaining: Infinity, resetAt: 0 };
  }
}

class MemoryLimiter implements RateLimiter {
  readonly kind = "memory";
  private hits = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Expired keys are dead weight in a long-lived instance, and this map is
   * keyed by attacker-controlled input — so it gets swept rather than grown.
   */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    this.sweep(now);

    const existing = this.hits.get(key);
    const entry =
      existing && existing.resetAt > now
        ? existing
        : { count: 0, resetAt: now + this.windowMs };

    entry.count += 1;
    this.hits.set(key, entry);

    return {
      ok: entry.count <= this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - entry.count),
      resetAt: entry.resetAt,
    };
  }
}

class UpstashLimiter implements RateLimiter {
  readonly kind = "upstash";

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly limit: number,
    private readonly windowSeconds: number,
    private readonly namespace: string,
  ) {}

  async check(key: string): Promise<RateLimitResult> {
    const namespaced = `counterpart:rl:${this.namespace}:${key}`;

    // INCR then EXPIRE ... NX sets the TTL only on the first hit of a window,
    // so the window is fixed rather than sliding forward on every request.
    const response = await fetch(`${this.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", namespaced],
        ["EXPIRE", namespaced, String(this.windowSeconds), "NX"],
        ["PTTL", namespaced],
      ]),
    });

    if (!response.ok) {
      // A limiter outage must not take the site down with it. Fail open and
      // log — the alternative is a Redis blip turning into a total outage.
      const detail = await response.text().catch(() => "");
      console.error(`[rate-limit] upstash failed (${response.status}): ${detail.slice(0, 200)}`);
      return { ok: true, limit: this.limit, remaining: this.limit, resetAt: 0 };
    }

    const results = (await response.json()) as Array<{ result: number }>;
    const count = Number(results[0]?.result ?? 0);
    const ttlMs = Number(results[2]?.result ?? this.windowSeconds * 1000);

    return {
      ok: count <= this.limit,
      limit: this.limit,
      remaining: Math.max(0, this.limit - count),
      resetAt: Date.now() + Math.max(0, ttlMs),
    };
  }
}

/**
 * Cached per namespace so the memory backend's map actually persists, and so
 * two endpoints with different budgets don't share one counter. Chat is a
 * browsing activity; sending a message is not, and they need separate ceilings.
 */
const limiters = new Map<string, RateLimiter>();

export function createRateLimiter(
  config: EnvConfig,
  requests: number,
  windowSeconds: number,
  namespace: string,
): RateLimiter {
  const existing = limiters.get(namespace);
  if (existing) return existing;

  const { enabled, upstash } = config.limits.rate;

  const limiter: RateLimiter = !enabled
    ? new NoopLimiter()
    : upstash.url && upstash.token
      ? new UpstashLimiter(upstash.url, upstash.token, requests, windowSeconds, namespace)
      : new MemoryLimiter(requests, windowSeconds * 1000);

  limiters.set(namespace, limiter);
  return limiter;
}

/** The chat endpoint's limiter, using the configured `RATE_LIMIT_*` budget. */
export function getRateLimiter(config: EnvConfig): RateLimiter {
  const { requests, windowSeconds } = config.limits.rate;
  return createRateLimiter(config, requests, windowSeconds, "chat");
}

/**
 * Best-effort caller identity. Behind Vercel and most proxies the client IP is
 * the first entry of `x-forwarded-for`; everything else is a fallback so a
 * local or misconfigured deploy still gets *a* bucket rather than none.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "anonymous";
}
