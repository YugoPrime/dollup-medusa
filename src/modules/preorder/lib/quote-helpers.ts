/**
 * Pure helpers for the SHEIN quote-intake flow. No Medusa/DB dependency —
 * unit-tested in isolation, composed by the service layer.
 */

// Mirror the bookmarklet's host check (api/hooks/preorder-bookmarklet/route.ts):
// shein.com with an optional single-label subdomain (www, m, us, etc.).
const SHEIN_URL_RE = /^https?:\/\/(?:[a-z0-9-]+\.)?shein\.com\//i

export function isValidSheinUrl(url: string): boolean {
  if (typeof url !== "string") return false
  return SHEIN_URL_RE.test(url.trim())
}

export function parseQuoteUrls(raw: string): string[] {
  if (typeof raw !== "string") return []
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

export function parseQuoteUrlsCapped(
  raw: string,
  max: number,
): { urls: string[]; dropped: number } {
  const all = parseQuoteUrls(raw)
  return { urls: all.slice(0, max), dropped: Math.max(0, all.length - max) }
}

export type QuoteItemStatusLike = { status: string }
export type RequestStatus =
  | "pending"
  | "quoted"
  | "partial"
  | "needs_manual"
  | "reserved"

/**
 * Roll N item statuses up to the request status.
 * - Any item still in-flight (pending|scraping) -> "pending".
 * - All reserved -> "reserved"; all quoted -> "quoted"; all needs_manual -> "needs_manual".
 * - Otherwise a resolved mix -> "partial".
 * `failed` items are treated as resolved-but-not-actionable (don't block "quoted"/rollup);
 * they neither force "partial" alone nor count as quoted.
 */
export function rollupRequestStatus(
  items: QuoteItemStatusLike[],
): RequestStatus {
  if (items.length === 0) return "pending"
  const inFlight = items.some(
    (i) => i.status === "pending" || i.status === "scraping",
  )
  if (inFlight) return "pending"

  const actionable = items.filter((i) => i.status !== "failed")
  if (actionable.length === 0) return "needs_manual" // all failed -> owner sees it

  const allReserved = actionable.every((i) => i.status === "reserved")
  if (allReserved) return "reserved"
  const allQuoted = actionable.every((i) => i.status === "quoted")
  if (allQuoted) return "quoted"
  const allManual = actionable.every((i) => i.status === "needs_manual")
  if (allManual) return "needs_manual"
  return "partial"
}

const MS_PER_MIN = 60_000

/** A scraping lock older than `maxAgeMin` (or absent) is reclaimable. */
export function isLockStale(
  lockedAt: Date | null,
  now: Date,
  maxAgeMin: number,
): boolean {
  if (!lockedAt) return true
  return now.getTime() - lockedAt.getTime() > maxAgeMin * MS_PER_MIN
}

/** Daemon is online if it heartbeat within `maxAgeMin`. */
export function isDaemonOnline(
  lastSeenAt: Date | null,
  now: Date,
  maxAgeMin: number,
): boolean {
  if (!lastSeenAt) return false
  return now.getTime() - lastSeenAt.getTime() <= maxAgeMin * MS_PER_MIN
}
