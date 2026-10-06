/** Per-route, per-IP sliding-window rate limiting (§9.11). */

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
}

export interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export interface RateLimiter {
  hit: (key: string) => RateDecision;
  prune: () => void;
  size: () => number;
}

/**
 * Sliding-window limiter keyed by IP. The bucket store is pruned on every hit
 * and capped at `maxKeys`, so it cannot grow without bound (§9.11).
 */
export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { limit, windowMs, maxKeys = 20_000, now = Date.now } = opts;
  const buckets = new Map<string, number[]>();

  const prune = (): void => {
    const cutoff = now() - windowMs;
    for (const [key, times] of buckets) {
      const alive = times.filter((t) => t > cutoff);
      if (alive.length === 0) buckets.delete(key);
      else buckets.set(key, alive);
    }
  };

  const hit = (key: string): RateDecision => {
    prune();
    // If we somehow exceed the cap, drop the oldest bucket entirely.
    if (buckets.size >= maxKeys && !buckets.has(key)) {
      const first = buckets.keys().next().value;
      if (first !== undefined) buckets.delete(first);
    }

    const t = now();
    const cutoff = t - windowMs;
    const times = (buckets.get(key) ?? []).filter((x) => x > cutoff);

    if (times.length >= limit) {
      buckets.set(key, times);
      const oldest = times[0] ?? t;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - t) / 1000));
      return { allowed: false, retryAfterSeconds, remaining: 0 };
    }

    times.push(t);
    buckets.set(key, times);
    return { allowed: true, retryAfterSeconds: 0, remaining: limit - times.length };
  };

  return { hit, prune, size: () => buckets.size };
}
