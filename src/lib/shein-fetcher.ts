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
const NAV_TIMEOUT_MS = 45_000
// SHEIN's /risk/challenge (captcha_type 909) is an ACTIVE JS challenge, not a
// passive wait-and-clear. We poll for the redirect away from /risk/challenge,
// then wait for the product JSON-LD to render. Total budget below.
const CHALLENGE_MAX_WAIT_MS = 20_000
const CHALLENGE_POLL_MS = 1_000

// Anti-detection: hide the headless/automation tells that an active challenge
// fingerprints. Runs before any page script. Built-in (no stealth dep) — the
// Node stealth packages are stale (2026) and patch fewer signals than this set
// plus channel:"chrome" + headful already cover for SHEIN's check.
const STEALTH_INIT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  window.chrome = window.chrome || { runtime: {} };
  const _q = window.navigator.permissions && window.navigator.permissions.query;
  if (_q) {
    window.navigator.permissions.query = (p) =>
      p && p.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : _q(p);
  }
`

/**
 * Real-Chrome fetcher. Uses the installed Chrome channel (not bundled Chromium)
 * in HEADFUL mode by default — the strongest free signal against SHEIN's active
 * 909 challenge. Override with SHEIN_FETCH_HEADLESS=true.
 *
 * Operational note: headful needs an interactive desktop session. On the laptop
 * daemon (Task Scheduler), run the task as the logged-in user with "Run only
 * when user is logged on" — see docs/LOCAL-SHEIN-DAEMON-SETUP.md.
 */
export class PlaywrightSheinFetcher implements SheinFetcher {
  private browser: Browser | null = null

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser) {
      // Default headful (strongest signal); SHEIN_FETCH_HEADLESS=true forces
      // headless. NOTE (verified 2026-06-06 live): neither headful real-Chrome
      // + stealth NOR a warmed session beats SHEIN's interactive 909 challenge
      // on PRODUCT pages — the homepage loads but PDPs are gated. Fingerprint
      // stealth is necessary-not-sufficient. Beating 909 needs a CAPTCHA solver
      // or residential-proxy IP reputation (swap in behind this class). Until
      // then the daemon routes challenged jobs to needs_manual (by design).
      const headless = process.env.SHEIN_FETCH_HEADLESS === "true"
      this.browser = await chromium.launch({
        headless,
        channel: "chrome", // use the real installed Chrome, not bundled Chromium
        args: ["--disable-blink-features=AutomationControlled"],
      })
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
    await context.addInitScript(STEALTH_INIT)
    const page = await context.newPage()
    try {
      const resp = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      })
      const status = resp?.status() ?? 0

      // Active-challenge handling: poll until we leave /risk/challenge (the
      // challenge JS redirects to the product page on success), up to the budget.
      const deadline = Date.now() + CHALLENGE_MAX_WAIT_MS
      while (isChallengeUrl(page.url()) && Date.now() < deadline) {
        await page.waitForTimeout(CHALLENGE_POLL_MS)
      }
      // Once on the product page, give the JSON-LD a moment to inject.
      if (!isChallengeUrl(page.url())) {
        await page
          .waitForSelector("script#goodsDetailSchema", { timeout: 8_000 })
          .catch(() => {})
      }

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
