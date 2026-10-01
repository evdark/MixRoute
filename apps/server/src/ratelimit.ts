/** Simple in-memory sliding-window rate limiter (per router API key). */

const buckets = new Map<string, number[]>();

export function checkRateLimit(key: string, rpm: number): { allowed: boolean; retryAfterSec: number } {
  if (rpm <= 0) return { allowed: true, retryAfterSec: 0 };
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (buckets.get(key) ?? []).filter((t) => t > windowStart);
  if (hits.length >= rpm) {
    const oldest = hits[0] ?? now;
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((oldest + 60_000 - now) / 1000)) };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { allowed: true, retryAfterSec: 0 };
}

/** Periodic cleanup so the map does not grow forever. */
export function startRateLimitCleanup(): NodeJS.Timeout {
  return setInterval(() => {
    const windowStart = Date.now() - 60_000;
    for (const [key, hits] of buckets) {
      const alive = hits.filter((t) => t > windowStart);
      if (alive.length === 0) buckets.delete(key);
      else buckets.set(key, alive);
    }
  }, 60_000);
}
