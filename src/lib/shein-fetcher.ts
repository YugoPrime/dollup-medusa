import { extractJsonLd } from "./shein-extract"
import { chromium, type Browser } from "playwright"

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

const REALISTIC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const NAV_TIMEOUT_MS = 30_000
// SHEIN's JS challenge resolves itself in a real browser within a few seconds;
// give it room, then re-read the URL to see if we landed on the product page.
const CHALLENGE_SETTLE_MS = 6_000

/**
 * Real-Chromium fetcher. Launches one browser, reuses it across calls (the
 * daemon claims up to `limit` jobs per tick), closes on daemon exit.
 */
export class PlaywrightSheinFetcher implements SheinFetcher {
  private browser: Browser | null = null

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true })
    }
    return this.browser
  }

  async fetchPdp(url: string): Promise<SheinFetchRaw> {
    const browser = await this.ensureBrowser()
    const context = await browser.newContext({
      userAgent: REALISTIC_UA,
      locale: "en-US",
      viewport: { width: 1280, height: 900 },
    })
    const page = await context.newPage()
    try {
      const resp = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      })
      const status = resp?.status() ?? 0
      // If we hit the challenge, wait for it to self-resolve and re-check.
      if (isChallengeUrl(page.url())) {
        await page.waitForTimeout(CHALLENGE_SETTLE_MS)
      }
      // Read after settle: SHEIN injects goodsDetailSchema once the real page renders.
      const html = await page.content()
      const finalUrl = page.url()
      return { status, finalUrl, html }
    } finally {
      await context.close()
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }
}
