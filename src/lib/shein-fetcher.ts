import { extractJsonLd } from "./shein-extract"

/** Raw result of loading a SHEIN URL in a browser. */
export type SheinFetchRaw = {
  status: number
  finalUrl: string
  html: string
}

export type FetchOutcomeKind = "ok" | "removed" | "challenge" | "parse-fail"

export function isChallengeUrl(url: string): boolean {
  return typeof url === "string" && url.includes("/risk/challenge")
}

/**
 * Classify a raw browser fetch. "ok" only when the goodsDetailSchema JSON-LD
 * actually parses — that's the contract the downstream scrape needs.
 */
export function classifyFetchOutcome(raw: SheinFetchRaw): {
  kind: FetchOutcomeKind
} {
  if (raw.status === 404) return { kind: "removed" }
  if (isChallengeUrl(raw.finalUrl)) return { kind: "challenge" }
  if (raw.status >= 400) return { kind: "challenge" } // 403/429/5xx behind the wall
  return extractJsonLd(raw.html) ? { kind: "ok" } : { kind: "parse-fail" }
}

/** Browser abstraction — Playwright impl below. Swappable for a paid API later. */
export interface SheinFetcher {
  fetchPdp(url: string): Promise<SheinFetchRaw>
  close(): Promise<void>
}
