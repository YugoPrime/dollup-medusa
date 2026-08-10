export const SESSION_HOURLY_LIMIT = 20
export const IP_DAILY_LIMIT = 60
export const MAX_MESSAGE_CHARS = 1000

type CacheLike = {
  get<T>(key: string): Promise<T | null | undefined>
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void>
}

/**
 * Fixed-window counter on the Medusa cache module (Redis-backed).
 *
 * Deliberately read-then-write rather than an atomic INCR: the cache module
 * exposes no atomic increment, and standing up a second Redis client for this
 * is not worth it. Two racing requests can therefore both observe the same
 * count and both pass, so the effective ceiling is `limit` plus in-flight
 * concurrency. That is acceptable — this is an anti-abuse speed bump, and the
 * monthly LLM spend cap (checked inside a per-thread lock) is the actual
 * money guarantee.
 *
 * Fails OPEN. If Redis is unreachable, a customer can still talk to the shop;
 * the alternative is a cache outage silently closing the storefront's support
 * channel.
 */
export async function checkAndIncrement(
  cache: CacheLike,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; count: number }> {
  let current = 0
  try {
    current = Number((await cache.get<number>(key)) ?? 0)
  } catch {
    return { allowed: true, count: 0 }
  }
  if (!Number.isFinite(current) || current < 0) current = 0

  if (current >= limit) {
    return { allowed: false, count: current }
  }

  const next = current + 1
  try {
    await cache.set(key, next, windowSeconds)
  } catch {
    /* counting is best-effort; never block a customer on a cache write */
  }
  return { allowed: true, count: next }
}

/** Current UTC hour bucket, e.g. "2026-08-10T14". */
export function hourBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 13)
}

/** Current UTC day bucket, e.g. "2026-08-10". */
export function dayBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}
