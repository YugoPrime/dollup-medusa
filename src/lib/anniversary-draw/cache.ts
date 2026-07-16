import type { DrawPayload } from "./entries"

const TTL_MS = 60_000

export const EMPTY_PAYLOAD: DrawPayload = {
  entries: [],
  count: 0,
  entryCount: 0,
  winnerId: null,
}

let cache: { at: number; payload: DrawPayload } | null = null

// In-flight fetch, shared by every caller that arrives while it is pending.
// Without this, every concurrent request on a cold/expired cache starts its
// own `fetcher()` call (thundering herd) instead of piggybacking on the one
// already running.
let inFlight: Promise<DrawPayload> | null = null

/** Exported for tests only. */
export function __resetCacheForTests(): void {
  cache = null
  inFlight = null
}

/**
 * 60s cache with last-good fallback. Keeps the wall to one Medusa query per
 * minute regardless of how many people are watching it on Aug 1.
 *
 * Never throws: on the campaign's highest-traffic day the page must degrade
 * to "no bubbles", never to an error.
 */
export async function cached(fetcher: () => Promise<DrawPayload>): Promise<DrawPayload> {
  const now = Date.now()
  if (cache && now - cache.at < TTL_MS) return cache.payload

  // Piggyback on an already-running fetch instead of starting a new one.
  // Concurrent callers all await the same promise, so a burst of requests at
  // the TTL boundary results in exactly one `fetcher()` call.
  if (inFlight) return inFlight

  const run = async (): Promise<DrawPayload> => {
    try {
      const payload = await fetcher()
      cache = { at: Date.now(), payload }
      return payload
    } catch (err) {
      console.error("[anniversary-draw] failed to load entries", err)
      // Stamp `at` with a fresh timestamp even on failure. Otherwise the
      // stale `at` stays older than the TTL forever, so the very next call
      // sees the cache as expired and retries immediately — a failed
      // backend gets hammered with one query per request instead of one
      // retry per TTL window.
      cache = { at: Date.now(), payload: cache?.payload ?? EMPTY_PAYLOAD }
      return cache.payload
    } finally {
      inFlight = null
    }
  }

  inFlight = run()
  return inFlight
}
