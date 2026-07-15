import type { DrawPayload } from "./entries"

const TTL_MS = 60_000

export const EMPTY_PAYLOAD: DrawPayload = {
  entries: [],
  count: 0,
  entryCount: 0,
  winnerId: null,
}

let cache: { at: number; payload: DrawPayload } | null = null

/** Exported for tests only. */
export function __resetCacheForTests(): void {
  cache = null
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

  try {
    const payload = await fetcher()
    cache = { at: now, payload }
    return payload
  } catch (err) {
    console.error("[anniversary-draw] failed to load entries", err)
    return cache?.payload ?? EMPTY_PAYLOAD
  }
}
