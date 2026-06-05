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
