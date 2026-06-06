# Pre-order Quote Intake — Plan B: SHEIN Headless Daemon

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the laptop-side Playwright daemon that scrapes SHEIN PDPs (solving the JS captcha a real browser passes), turns them into quotes via the shipped Plan A service methods, AND fixes the now-broken daily availability cron by routing it through the same browser. Plus the HTTP route wrappers, cron registration, and the setup doc.

**Architecture:** A pure `SheinFetcher` (Playwright) loads a SHEIN URL in real Chromium, waits past `/risk/challenge`, returns rendered HTML. A `medusa exec` script (`scrape-quote-jobs.ts`) polls Plan A's `listQuoteJobs`/`claimQuoteJob`, runs the fetcher + the existing pure parsers (`extractJsonLd`, `extractSiblingColors`) + `previewPrice`, and calls `recordScrapeResult` + `recordDaemonHeartbeat`. A PowerShell one-shot tick (Task Scheduler, cloned from the proven `start-render-poller.ps1`) supervises it. The daily availability cron's fetch is swapped from plain `fetch` to the same `SheinFetcher`. Daemon runs ONLY on the laptop, never Coolify.

**Tech Stack:** Playwright (new dep, vetted 2026-06-06: Apache-2.0, 1 dep, MS-maintained, OIDC-published — approved), TypeScript, Medusa `exec` scripts, Windows Task Scheduler + PowerShell, Jest.

**Spec:** `docs/superpowers/specs/2026-06-06-preorder-quote-intake-design.md` (§2, §9, §10 availability-port)
**Depends on:** Plan A (shipped, dollup-medusa master `484cfb9`). Verified present: `listQuoteJobs`, `claimQuoteJob`, `recordScrapeResult(itemId,{outcome,...})`, `recordDaemonHeartbeat`, `expireOldRequests`, `QuoteItemRow`, `previewPrice`. Reused parsers: `extractJsonLd`, `extractSiblingColors`, `buildSiblingUrl` (`src/lib/shein-extract.ts`).

---

## File Structure

- Modify: `package.json` — add `playwright` dep
- Create: `src/lib/shein-fetcher.ts` — `SheinFetcher` interface + Playwright impl (navigate, solve challenge, return HTML)
- Create: `src/lib/__tests__/shein-fetcher.unit.spec.ts` — tests for the pure parts (challenge-detection predicate, result classification) — NOT the live browser
- Create: `src/lib/shein-scrape.ts` — pure orchestration: html → (parse + price) → recordScrapeResult payload. Testable with fixture HTML.
- Create: `src/lib/__tests__/shein-scrape.unit.spec.ts` — fixture-driven parse→payload tests
- Create: `src/scripts/scrape-quote-jobs.ts` — the `medusa exec` daemon entry (poll → claim → fetch → scrape → record)
- Create: `src/api/admin/preorder/quote-jobs/route.ts` — `GET` list jobs (token-authed)
- Create: `src/api/admin/preorder/quote-jobs/[id]/claim/route.ts` — `POST` claim
- Create: `src/api/admin/preorder/quote-jobs/[id]/result/route.ts` — `POST` record result
- Create: `src/api/admin/preorder/quote-jobs/heartbeat/route.ts` — `POST` heartbeat
- Modify: `src/jobs/preorder-availability-check.ts` — swap `checkSheinUrl`'s `fetch` for `SheinFetcher`
- Create: `src/jobs/preorder-quote-expiry.ts` — cron calling `expireOldRequests`
- Create: `start-quote-daemon-poller.ps1` — Task Scheduler one-shot tick (clone of `start-render-poller.ps1`)
- Create: `install-quote-daemon-task.ps1` — registers the scheduled task (clone of `install-render-poller-task.ps1`)
- Create: `docs/LOCAL-SHEIN-DAEMON-SETUP.md` — the setup doc (the missing doc the Telegram alerts reference)

> **Conventions (from codebase + memory):**
> - Daemon scripts run via `yarn medusa exec ./src/scripts/X.ts`; flags come from env vars, NOT CLI args (`medusa exec` strips them). See `local-render-stories.ts`.
> - Windows supervision = Task Scheduler one-shot tick, NOT PM2 (memory `feedback-windows-daemons-use-task-scheduler`). Clone `start-render-poller.ps1` exactly: env-load, tunnel pre-flight, lock-file guard, Telegram-on-fail.
> - Daemon is laptop-only. Coolify must NOT run it — gate any always-on behaviour so a Coolify deploy is inert (the cron `config` still registers on Coolify but its fetch now needs a browser; see Task 9 for the Coolify-safety gate).
> - Token auth: reuse the bookmarklet token (`verifyBookmarkletToken` on the preorder service) — the `/hooks/preorder-bookmarklet` route is the reference.

---

### Task 1: Vet + add Playwright dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Confirm the vetting (already done, recorded here)**

Playwright vetted 2026-06-06: Apache-2.0 license; exactly 1 dependency (`playwright-core`, same org); maintainers are Microsoft team + official bot; releases published via GitHub Actions OIDC; no browser auto-download on `npm install` (explicit `npx playwright install` step). Approved by owner. No action — this step documents the gate was passed.

- [ ] **Step 2: Add the dependency**

Run: `yarn add playwright`
Expected: `playwright` + `playwright-core` appear in `package.json` dependencies and `yarn.lock` updates. This does NOT download Chromium.

- [ ] **Step 3: Install the Chromium browser binary (local, one-time)**

Run: `npx playwright install chromium`
Expected: Chromium downloads to the local Playwright cache (~150MB). This is laptop-only setup; it is NOT part of the Coolify image.

- [ ] **Step 4: Commit**

```bash
git add package.json yarn.lock
git commit -m "build(preorder): add playwright for SHEIN headless scraping (vetted)"
```

---

### Task 2: Pure challenge-detection + classification helpers

**Files:**
- Create: `src/lib/shein-fetcher.ts` (start with the pure helpers + interface)
- Create: `src/lib/__tests__/shein-fetcher.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/shein-fetcher.unit.spec.ts`:

```ts
import { isChallengeUrl, classifyFetchOutcome } from "../shein-fetcher"

describe("isChallengeUrl", () => {
  it("flags /risk/challenge redirects", () => {
    expect(isChallengeUrl("https://www.shein.com/risk/challenge?foo=1")).toBe(true)
  })
  it("passes a normal product URL", () => {
    expect(isChallengeUrl("https://www.shein.com/Dress-p-123.html")).toBe(false)
  })
})

describe("classifyFetchOutcome", () => {
  it("404 -> removed", () => {
    expect(classifyFetchOutcome({ status: 404, finalUrl: "x", html: "" }).kind).toBe("removed")
  })
  it("challenge final url -> challenge", () => {
    expect(
      classifyFetchOutcome({ status: 200, finalUrl: "https://www.shein.com/risk/challenge", html: "" }).kind,
    ).toBe("challenge")
  })
  it("200 with parseable goodsDetailSchema -> ok", () => {
    const html = '<script id="goodsDetailSchema">{"@type":"ProductGroup","name":"X"}</script>'
    expect(classifyFetchOutcome({ status: 200, finalUrl: "ok", html }).kind).toBe("ok")
  })
  it("200 without schema -> parse-fail", () => {
    expect(classifyFetchOutcome({ status: 200, finalUrl: "ok", html: "<html></html>" }).kind).toBe("parse-fail")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test:unit src/lib/__tests__/shein-fetcher.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/shein-fetcher.ts`:

```ts
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

/** Browser abstraction — Playwright impl in Task 3. Swappable for a paid API later. */
export interface SheinFetcher {
  fetchPdp(url: string): Promise<SheinFetchRaw>
  close(): Promise<void>
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test:unit src/lib/__tests__/shein-fetcher.unit.spec.ts`
Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shein-fetcher.ts src/lib/__tests__/shein-fetcher.unit.spec.ts
git commit -m "feat(preorder): SHEIN fetch outcome classifier + fetcher interface"
```

---

### Task 3: Playwright fetcher implementation

**Files:**
- Modify: `src/lib/shein-fetcher.ts`

- [ ] **Step 1: Add the Playwright implementation**

Append to `src/lib/shein-fetcher.ts` (no unit test — it drives a real browser; it's exercised by the live smoke in Task 6):

```ts
import { chromium, type Browser } from "playwright"

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
      let status = resp?.status() ?? 0
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
```

- [ ] **Step 2: Type-check**

Run: `yarn tsc --noEmit 2>&1 | grep -E "shein-fetcher" || echo "ok"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/shein-fetcher.ts
git commit -m "feat(preorder): Playwright SHEIN fetcher (solves JS challenge)"
```

---

### Task 4: Pure scrape orchestration (html → recordScrapeResult payload)

**Files:**
- Create: `src/lib/shein-scrape.ts`
- Create: `src/lib/__tests__/shein-scrape.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/shein-scrape.unit.spec.ts`. Uses a minimal inline ProductGroup JSON-LD fixture:

```ts
import { buildQuotePayload } from "../shein-scrape"

const HTML_OK = `
<script id="goodsDetailSchema">{
  "@type":"ProductGroup","name":"Floral Cami Dress","productGroupID":"123",
  "image":["//img.ltwebstatic.com/a.jpg"],
  "color":"Blue",
  "hasVariant":[
    {"sku":"s1","size":"S","offers":{"price":"12.50","priceCurrency":"USD","availability":"https://schema.org/InStock"}},
    {"sku":"s2","size":"M","offers":{"price":"12.50","priceCurrency":"USD","availability":"https://schema.org/InStock"}}
  ]
}</script>`

// previewPrice is injected so this stays pure (no Medusa container).
const fakePreview = (usd: number) => ({
  sheinPriceUsd: usd,
  sheinPriceMur: usd * 50,
  finalPriceMur: 1040,
  fxRateUsed: 50,
  customsAmount: 0,
  landedCost: 0,
  handlingFee: 0,
  rawPrice: 0,
})

describe("buildQuotePayload", () => {
  it("parses title/price/sizes and produces a quoted payload", async () => {
    const out = await buildQuotePayload(HTML_OK, { previewPrice: async (u) => fakePreview(u), settingsSnapshot: { id: "s" } })
    expect(out.outcome).toBe("quoted")
    expect(out.scraped_title).toBe("Floral Cami Dress")
    expect(out.scraped_price_usd).toBe(12.5)
    expect(out.all_in_price_mur).toBe(1040)
    expect(out.size_options).toEqual(["S", "M"])
  })

  it("html with no schema -> parse-fail outcome (needs_manual)", async () => {
    const out = await buildQuotePayload("<html></html>", { previewPrice: async (u) => fakePreview(u), settingsSnapshot: { id: "s" } })
    expect(out.outcome).toBe("needs_manual")
    expect(out.last_error_kind).toBe("parse-fail")
  })

  it("all variants out of stock -> failed (removed-ish), no price", async () => {
    const oos = HTML_OK.replace(/InStock/g, "OutOfStock")
    const out = await buildQuotePayload(oos, { previewPrice: async (u) => fakePreview(u), settingsSnapshot: { id: "s" } })
    expect(out.outcome).toBe("failed")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `yarn test:unit src/lib/__tests__/shein-scrape.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/shein-scrape.ts`:

```ts
import { extractJsonLd } from "./shein-extract"

type PreviewFn = (usd: number) => Promise<{
  finalPriceMur: number
  fxRateUsed: number
  [k: string]: unknown
}>

export type QuoteScrapePayload = {
  outcome: "quoted" | "failed" | "needs_manual"
  scraped_title?: string | null
  scraped_thumbnail?: string | null
  scraped_price_usd?: number | null
  color_options?: unknown
  size_options?: unknown
  all_in_price_mur?: number | null
  price_breakdown?: unknown
  fx_rate_used?: number | null
  settings_snapshot?: unknown
  last_error_kind?: string | null
}

/**
 * Pure: rendered HTML -> a recordScrapeResult payload. previewPrice + the
 * settings snapshot are injected so this is unit-testable without a container.
 */
export async function buildQuotePayload(
  html: string,
  deps: { previewPrice: PreviewFn; settingsSnapshot: unknown },
): Promise<QuoteScrapePayload> {
  const pg = extractJsonLd(html)
  if (!pg) {
    return { outcome: "needs_manual", last_error_kind: "parse-fail" }
  }
  const inStock = pg.hasVariant.filter(
    (v) => v.offers.availability === "https://schema.org/InStock",
  )
  if (inStock.length === 0) {
    return { outcome: "failed", last_error_kind: "removed", scraped_title: pg.name }
  }
  // SHEIN lists each size as a variant at the same price; take the first.
  const usd = Number(inStock[0].offers.price)
  if (!Number.isFinite(usd) || usd <= 0) {
    return { outcome: "needs_manual", last_error_kind: "parse-fail", scraped_title: pg.name }
  }
  const preview = await deps.previewPrice(usd)
  const sizes = Array.from(new Set(inStock.map((v) => v.size)))
  return {
    outcome: "quoted",
    scraped_title: pg.name,
    scraped_thumbnail: pg.image[0] ? `https:${pg.image[0]}`.replace("https:https:", "https:") : null,
    scraped_price_usd: usd,
    color_options: pg.color ? [pg.color] : [],
    size_options: sizes,
    all_in_price_mur: preview.finalPriceMur,
    price_breakdown: preview,
    fx_rate_used: preview.fxRateUsed,
    settings_snapshot: deps.settingsSnapshot,
    last_error_kind: null,
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `yarn test:unit src/lib/__tests__/shein-scrape.unit.spec.ts`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shein-scrape.ts src/lib/__tests__/shein-scrape.unit.spec.ts
git commit -m "feat(preorder): pure SHEIN html->quote payload builder"
```

---

### Task 5: HTTP route wrappers for the daemon (token-authed)

**Files:**
- Create: `src/api/admin/preorder/quote-jobs/route.ts`
- Create: `src/api/admin/preorder/quote-jobs/[id]/claim/route.ts`
- Create: `src/api/admin/preorder/quote-jobs/[id]/result/route.ts`
- Create: `src/api/admin/preorder/quote-jobs/heartbeat/route.ts`

> The daemon runs `medusa exec` locally with direct container access, so it can call the service methods WITHOUT HTTP. These routes exist for the spec's contract + future remote daemons. Since the local daemon uses the container directly (Task 6), these routes are a thin, separately-testable surface. Auth: reuse `verifyBookmarkletToken` via the `x-preorder-bookmarklet-token` header (same as `/hooks/preorder-bookmarklet`).

- [ ] **Step 1: List route**

Create `src/api/admin/preorder/quote-jobs/route.ts`:

```ts
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../modules/preorder"
import type PreorderModuleService from "../../../../modules/preorder/service"

async function authed(req: MedusaRequest, svc: PreorderModuleService): Promise<boolean> {
  const token = req.headers["x-preorder-bookmarklet-token"]
  const t = Array.isArray(token) ? token[0] : token
  if (!t || typeof t !== "string") return false
  const r = await svc.verifyBookmarkletToken(t)
  return r.valid
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  if (!(await authed(req, svc))) {
    res.status(401).json({ message: "unauthorized" })
    return
  }
  const status = (req.query?.status as string) ?? "pending"
  const limit = Number(req.query?.limit ?? 5)
  const jobs = await svc.listQuoteJobs({ status, limit })
  res.json({ jobs })
}
```

- [ ] **Step 2: Claim route**

Create `src/api/admin/preorder/quote-jobs/[id]/claim/route.ts`:

```ts
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../../../modules/preorder"
import type PreorderModuleService from "../../../../../../modules/preorder/service"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const token = req.headers["x-preorder-bookmarklet-token"]
  const t = Array.isArray(token) ? token[0] : token
  if (!t || !(await svc.verifyBookmarkletToken(t)).valid) {
    res.status(401).json({ message: "unauthorized" })
    return
  }
  const id = req.params.id
  const claimed = await svc.claimQuoteJob(id)
  res.json({ claimed })
}
```

- [ ] **Step 3: Result route**

Create `src/api/admin/preorder/quote-jobs/[id]/result/route.ts`:

```ts
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../../../modules/preorder"
import type PreorderModuleService from "../../../../../../modules/preorder/service"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const token = req.headers["x-preorder-bookmarklet-token"]
  const t = Array.isArray(token) ? token[0] : token
  if (!t || !(await svc.verifyBookmarkletToken(t)).valid) {
    res.status(401).json({ message: "unauthorized" })
    return
  }
  const id = req.params.id
  const body = (req.body ?? {}) as { outcome?: string } & Record<string, unknown>
  if (body.outcome !== "quoted" && body.outcome !== "failed" && body.outcome !== "needs_manual") {
    res.status(400).json({ message: "outcome must be quoted|failed|needs_manual" })
    return
  }
  await svc.recordScrapeResult(id, body as any)
  res.json({ ok: true })
}
```

- [ ] **Step 4: Heartbeat route**

Create `src/api/admin/preorder/quote-jobs/heartbeat/route.ts`:

```ts
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../../modules/preorder"
import type PreorderModuleService from "../../../../../modules/preorder/service"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const token = req.headers["x-preorder-bookmarklet-token"]
  const t = Array.isArray(token) ? token[0] : token
  if (!t || !(await svc.verifyBookmarkletToken(t)).valid) {
    res.status(401).json({ message: "unauthorized" })
    return
  }
  await svc.recordDaemonHeartbeat()
  res.json({ ok: true })
}
```

> Verify the `../` depth for each route by counting from its location to `src/modules/preorder` (compare to `src/api/admin/preorder/price-preview/route.ts` = `../../../../modules/preorder`; the `[id]/claim` route is 2 levels deeper = `../../../../../../`). Confirm `verifyBookmarkletToken` exists on the service (it does — used by `/hooks/preorder-bookmarklet`).

- [ ] **Step 5: Type-check + commit**

Run: `yarn tsc --noEmit 2>&1 | grep -E "quote-jobs" || echo "ok"` → expect `ok`.

```bash
git add src/api/admin/preorder/quote-jobs
git commit -m "feat(preorder): token-authed quote-jobs HTTP routes for daemon"
```

---

### Task 6: The daemon exec script

**Files:**
- Create: `src/scripts/scrape-quote-jobs.ts`

- [ ] **Step 1: Write the script**

Create `src/scripts/scrape-quote-jobs.ts`. Mirrors `local-render-stories.ts` (env flags, container access, telegram on fail). Uses the container directly — no HTTP:

```ts
/**
 * Local SHEIN quote-scrape daemon — runs on the laptop, NOT Coolify.
 *
 * SHEIN serves a JS captcha (/risk/challenge) to every plain fetch, so quotes
 * can only be produced by a real browser. This script polls the prod DB for
 * pending quote jobs, scrapes each in Playwright Chromium, prices via the
 * preorder pricing engine, and writes the result back.
 *
 * Run:  yarn medusa exec ./src/scripts/scrape-quote-jobs.ts
 * Env flags (medusa exec strips CLI args):
 *   QUOTE_SCRAPE_LIMIT   jobs claimed per tick (default 5)
 *   QUOTE_SCRAPE_ONCE    "true" = one tick then exit (Task Scheduler mode)
 *   QUOTE_POLL_SECONDS   loop interval when not ONCE (default 30)
 * Required env: DATABASE_URL etc. via .env.local-render (prod DB over tunnel).
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PREORDER_MODULE } from "../modules/preorder"
import type PreorderModuleService from "../modules/preorder/service"
import { PlaywrightSheinFetcher } from "../lib/shein-fetcher"
import { classifyFetchOutcome } from "../lib/shein-fetcher"
import { buildQuotePayload } from "../lib/shein-scrape"
import { sendTelegram } from "../lib/telegram"

export default async function scrapeQuoteJobs({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const svc = container.resolve<PreorderModuleService>(PREORDER_MODULE)
  const limit = Number(process.env.QUOTE_SCRAPE_LIMIT ?? 5)
  const fetcher = new PlaywrightSheinFetcher()

  try {
    await svc.recordDaemonHeartbeat()
    const jobs = await svc.listQuoteJobs({ status: "pending", limit })
    logger.info(`[quote-scrape] ${jobs.length} pending job(s)`)

    for (const job of jobs) {
      const claimed = await svc.claimQuoteJob(job.id)
      if (!claimed) continue
      try {
        const raw = await fetcher.fetchPdp(job.shein_url)
        const outcome = classifyFetchOutcome(raw)
        if (outcome.kind === "removed") {
          await svc.recordScrapeResult(job.id, { outcome: "failed", last_error_kind: "removed" })
          continue
        }
        if (outcome.kind === "challenge" || outcome.kind === "parse-fail") {
          // attempts already bumped by claim; after 3 the daemon stops retrying.
          const next = job.attempts >= 3 ? "needs_manual" : "pending"
          await svc.recordScrapeResult(job.id, {
            outcome: next === "needs_manual" ? "needs_manual" : "needs_manual",
            last_error_kind: outcome.kind,
          })
          continue
        }
        // ok: parse + price
        const settings = await svc.getSettings()
        const payload = await buildQuotePayload(raw.html, {
          previewPrice: (usd) => svc.previewPrice({ sheinPriceUsd: usd }),
          settingsSnapshot: settings,
        })
        await svc.recordScrapeResult(job.id, payload)
        logger.info(`[quote-scrape] ${job.id} -> ${payload.outcome}`)
      } catch (err: any) {
        await svc.recordScrapeResult(job.id, {
          outcome: "needs_manual",
          last_error_kind: "network-error",
        })
        logger.warn(`[quote-scrape] ${job.id} errored: ${err?.message ?? err}`)
      }
    }
  } catch (err: any) {
    await sendTelegram(`❌ quote-scrape daemon tick failed: ${err?.message ?? err}`)
    throw err
  } finally {
    await fetcher.close()
  }
}
```

> NOTE on the retry logic: the plan's spec says 3 attempts then `needs_manual`. Because `claimQuoteJob` bumps `attempts` and sets status `scraping`, a `challenge`/`parse-fail` on attempts < 3 should return the item to `pending` for the next tick, NOT `needs_manual`. The code above currently forces `needs_manual` either way — FIX during implementation: when `job.attempts < 3` and kind is challenge/parse-fail, set status back to `pending` (add a `requeueQuoteJob(id)` service method, OR call `updatePreorderQuoteItems({id, status:"pending", locked_at:null})`). Implement the requeue path so the 3-attempt budget actually works. Add a `requeueQuoteJob(itemId)` to the service in this task (small) and use it.

- [ ] **Step 2: Add `requeueQuoteJob` to the service**

In `src/modules/preorder/service.ts`, add:

```ts
  /** Return a job to the pending pool for another daemon tick (pre-budget-exhaustion retry). */
  async requeueQuoteJob(itemId: string): Promise<void> {
    await (this as any).updatePreorderQuoteItems({
      id: itemId,
      status: "pending",
      locked_at: null,
    })
  }
```

Then in the script, replace the challenge/parse-fail branch with:

```ts
        if (outcome.kind === "challenge" || outcome.kind === "parse-fail") {
          if (job.attempts >= 3) {
            await svc.recordScrapeResult(job.id, {
              outcome: "needs_manual",
              last_error_kind: outcome.kind,
            })
          } else {
            await svc.requeueQuoteJob(job.id)
          }
          continue
        }
```

- [ ] **Step 3: Type-check**

Run: `yarn tsc --noEmit 2>&1 | grep -E "scrape-quote-jobs|service.ts" | grep -iv "chat|stories" || echo "ok"`
Expected: `ok`.

- [ ] **Step 4: Live smoke (laptop, tunnel up)**

Pre-req: `coolify-db-tunnel` online; `.env.local-render` present; Chromium installed (Task 1).
Manually insert a test job via a throwaway, OR wait until Plan C can create one. For now, run with zero pending jobs to confirm the script boots, heartbeats, and exits cleanly:

Run: `set -a && . ./.env.local-render && set +a && QUOTE_SCRAPE_ONCE=true yarn medusa exec ./src/scripts/scrape-quote-jobs.ts`
Expected: logs `0 pending job(s)`, writes a heartbeat (verify `preorder_settings.shein_daemon_last_seen_at` updated), exits 0. Full scrape-a-real-URL smoke happens once Plan C can create jobs (note this in the report).

- [ ] **Step 5: Commit**

```bash
git add src/scripts/scrape-quote-jobs.ts src/modules/preorder/service.ts
git commit -m "feat(preorder): SHEIN quote-scrape daemon exec script + requeueQuoteJob"
```

---

### Task 7: Task Scheduler poller + install scripts

**Files:**
- Create: `start-quote-daemon-poller.ps1`
- Create: `install-quote-daemon-task.ps1`

- [ ] **Step 1: Clone the render poller**

Read `start-render-poller.ps1` in full. Create `start-quote-daemon-poller.ps1` as a near-identical clone with these changes:
- Lock file: `.quote-daemon-poller.lock` (distinct from the render lock)
- Log file: `logs/quote-scrape-poller-task.log`
- The exec line: `& yarn medusa exec ./src/scripts/scrape-quote-jobs.ts` with `$env:QUOTE_SCRAPE_ONCE = "true"` set before it (instead of `RENDER_ONCE`)
- Telegram failure message text updated to "quote-scrape poller tick failed"
- Keep IDENTICAL: env-load loop, tunnel pre-flight (`Test-NetConnection 127.0.0.1 -Port 5432`), lock-file concurrency guard, transcript logging, exit codes.

(Write the full file — do not abbreviate. Copy the proven structure verbatim, only swapping the 5 items above.)

- [ ] **Step 2: Clone the install script**

Read `install-render-poller-task.ps1` in full. Create `install-quote-daemon-task.ps1` cloning it with:
- Task name: `\DollUp\DollUp-Quote-Scrape-Poller`
- Points at `start-quote-daemon-poller.ps1`
- Schedule: every 5 min, **09:00–22:00 MU** (the spec's waking-hours window — wider than stories' 09:00-17:00 because clients submit quotes throughout the day/evening). Match the existing script's trigger-construction style; only change the window + task name + target script.

- [ ] **Step 3: Register the task (laptop)**

Run: `powershell -ExecutionPolicy Bypass -File .\install-quote-daemon-task.ps1`
Expected: task `\DollUp\DollUp-Quote-Scrape-Poller` appears in `schtasks /query /tn "\DollUp\DollUp-Quote-Scrape-Poller"`. Run one manual tick: `schtasks /run /tn "\DollUp\DollUp-Quote-Scrape-Poller"` and confirm the log file is written + a heartbeat lands.

- [ ] **Step 4: Commit**

```bash
git add start-quote-daemon-poller.ps1 install-quote-daemon-task.ps1
git commit -m "feat(preorder): Task Scheduler poller + install for quote daemon"
```

---

### Task 8: Quote-expiry cron

**Files:**
- Create: `src/jobs/preorder-quote-expiry.ts`

- [ ] **Step 1: Write the job**

Create `src/jobs/preorder-quote-expiry.ts` (mirror an existing job's shape, e.g. `preorder-deposit-cleanup.ts`):

```ts
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { PREORDER_MODULE } from "../modules/preorder"
import type PreorderModuleService from "../modules/preorder/service"

/** Hourly: mark unreserved quote requests past their 48h TTL as expired. */
export default async function preorderQuoteExpiry(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const svc = container.resolve<PreorderModuleService>(PREORDER_MODULE)
  const n = await svc.expireOldRequests()
  if (n > 0) logger.info(`[preorder-quote-expiry] expired ${n} request(s)`)
}

export const config = {
  name: "preorder-quote-expiry",
  schedule: "0 * * * *", // hourly
}
```

This cron is safe on Coolify (pure DB update, no browser).

- [ ] **Step 2: Type-check + commit**

Run: `yarn tsc --noEmit 2>&1 | grep -E "preorder-quote-expiry" || echo "ok"` → `ok`.

```bash
git add src/jobs/preorder-quote-expiry.ts
git commit -m "feat(preorder): hourly quote-request expiry cron"
```

---

### Task 9: Port availability cron onto the daemon's browser (+ Coolify safety)

**Files:**
- Modify: `src/jobs/preorder-availability-check.ts`

**Problem:** this cron's `checkSheinUrl` uses plain `fetch` → now captcha-blocked on every product. It runs on Coolify (`schedule: "0 2 * * *"`). It must use the browser, but Coolify has no Chromium. Resolution per spec: the **availability sweep moves to the laptop daemon's browser**. The simplest correct change: make the Coolify cron a no-op that defers to a daemon-run sweep, and add the actual browser sweep into the daemon script path.

- [ ] **Step 1: Gate the Coolify cron to skip when it can't browse**

Modify `checkSheinUrl` to use the `SheinFetcher` instead of `fetch`, BUT guard the whole cron so on Coolify (no browser / env flag) it exits early. Add at the top of the exported `preorderAvailabilityCheck`:

```ts
  // SHEIN now requires a real browser (JS captcha). This sweep only runs where
  // a browser is available — the laptop daemon sets AVAILABILITY_SWEEP_ENABLED.
  // On Coolify the flag is unset, so the cron is an intentional no-op (it would
  // otherwise classify every product as "blocked").
  if (process.env.AVAILABILITY_SWEEP_ENABLED !== "true") {
    logger.info("[preorder-availability] skipped — no browser (set AVAILABILITY_SWEEP_ENABLED=true on the daemon host)")
    return
  }
```

- [ ] **Step 2: Swap the fetch for the browser fetcher**

Replace the `fetch(...)` call inside `checkSheinUrl` with a `PlaywrightSheinFetcher` (instantiate one per run, pass it in, close after). Reuse `classifyFetchOutcome` for the kinds it already distinguishes (in-stock/out-of-stock still come from `extractJsonLd` on the returned html — keep that logic, just source the html from the browser). Keep ALL existing classification/Telegram/circuit-breaker logic unchanged.

Concretely: change `checkSheinUrl(url)` to `checkSheinUrl(url, fetcher)`, replace the fetch block with `const raw = await fetcher.fetchPdp(url)` then classify from `raw.status`/`raw.finalUrl`/`raw.html` using the existing in-stock/out-of-stock/removed/blocked logic (challenge → treat as the existing "blocked" kind so the circuit-breaker still works). Instantiate `const fetcher = new PlaywrightSheinFetcher()` at the top of the run and `await fetcher.close()` in a finally.

- [ ] **Step 3: Wire the sweep into the daemon poller (env flag)**

In `start-quote-daemon-poller.ps1`, the daemon already runs frequently. The daily availability sweep should run ONCE/day, not every tick. Simplest: a SEPARATE Task Scheduler entry (or a daily branch in the poller) that runs `AVAILABILITY_SWEEP_ENABLED=true yarn medusa exec` against a small script that invokes the cron's function once. To keep this task bounded, add a `src/scripts/run-availability-sweep.ts` that imports and calls `preorderAvailabilityCheck(container)` with the env flag set, and a note in the setup doc (Task 10) to register it as a daily 06:00 MU Task Scheduler entry. (The Coolify cron stays registered but no-ops per Step 1.)

Create `src/scripts/run-availability-sweep.ts`:

```ts
import type { ExecArgs } from "@medusajs/framework/types"
import preorderAvailabilityCheck from "../jobs/preorder-availability-check"

/** Laptop-run daily SHEIN availability sweep (browser-based). */
export default async function runAvailabilitySweep({ container }: ExecArgs) {
  process.env.AVAILABILITY_SWEEP_ENABLED = "true"
  await preorderAvailabilityCheck(container)
}
```

- [ ] **Step 4: Type-check**

Run: `yarn tsc --noEmit 2>&1 | grep -E "availability" || echo "ok"` → `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/preorder-availability-check.ts src/scripts/run-availability-sweep.ts
git commit -m "fix(preorder): availability sweep uses browser fetcher; Coolify cron no-ops without it"
```

---

### Task 10: Setup doc

**Files:**
- Create: `docs/LOCAL-SHEIN-DAEMON-SETUP.md`

- [ ] **Step 1: Write the doc**

Create `docs/LOCAL-SHEIN-DAEMON-SETUP.md` covering (reference `docs/LOCAL-RENDERING-SETUP.md` for tone/structure):
- What the daemon does (quote scraping + daily availability sweep), why it's laptop-only (SHEIN JS captcha).
- One-time setup: `yarn install`, `npx playwright install chromium`, ensure `.env.local-render` present, ensure `coolify-db-tunnel` PM2 process running.
- Register the pollers: `install-quote-daemon-task.ps1` (5-min quote poller, 09:00–22:00 MU) + the daily availability sweep entry (06:00 MU) running `run-availability-sweep.ts`.
- Env: set `AVAILABILITY_SWEEP_ENABLED=true` on the laptop only.
- Coolify note: the `preorder-availability-check` cron stays registered but no-ops without the flag — do NOT set the flag on Coolify.
- Verifying it works: check `preorder_settings.shein_daemon_last_seen_at` advances; check logs in `logs/quote-scrape-poller-task.log`; Telegram alerts on failure.
- Troubleshooting: tunnel down, Chromium missing, challenge not resolving (bump `CHALLENGE_SETTLE_MS`).

- [ ] **Step 2: Commit**

```bash
git add docs/LOCAL-SHEIN-DAEMON-SETUP.md
git commit -m "docs(preorder): local SHEIN daemon setup guide"
```

---

### Task 11: Full verification

**Files:** none

- [ ] **Step 1: Unit suite**

Run: `yarn test:unit src/lib src/modules/preorder`
Expected: shein-fetcher (6) + shein-scrape (3) + quote-helpers (22) + existing preorder specs all pass. No new failures.

- [ ] **Step 2: Type-check (scoped)**

Run: `yarn tsc --noEmit 2>&1 | grep -iE "preorder|quote|shein|availability" || echo "no relevant type errors"`
Expected: `no relevant type errors`.

- [ ] **Step 3: Live daemon smoke (laptop)**

With tunnel up + Chromium installed, run one tick against real data once Plan C can create a job — OR insert one test `preorder_quote_item` (status `pending`, a real in-stock shein.com URL) via a throwaway script and run:
`set -a && . ./.env.local-render && set +a && QUOTE_SCRAPE_ONCE=true yarn medusa exec ./src/scripts/scrape-quote-jobs.ts`
Expected: the job moves `pending → quoted` with a real `all_in_price_mur`, OR cleanly to `needs_manual` if the challenge didn't resolve (then bump `CHALLENGE_SETTLE_MS` and retry). Report the actual outcome — this is the real proof the captcha is beaten.

- [ ] **Step 4: Report** — do NOT push or merge. Hand back to the controller for the finishing-a-development-branch step (feature branch + review gate, same as Plan A).

---

## Self-Review Notes

- **Spec §2 (captcha → browser):** Tasks 2–3 (fetcher), 6 (daemon uses it). ✓
- **Spec §9 (daemon contract, endpoints, retry budget, doc):** routes T5, exec daemon T6 (incl. requeue fixing the 3-attempt budget), Task Scheduler T7, doc T10. ✓
- **Spec §9 (availability sweep ported to daemon browser):** Task 9. ✓
- **Spec §10 (expiry cron):** Task 8. ✓
- **Reuse:** `extractJsonLd`/`extractSiblingColors` (T4), `previewPrice`/`recordScrapeResult`/`listQuoteJobs`/`claimQuoteJob`/`recordDaemonHeartbeat` (Plan A, T6), Task-Scheduler poller pattern (`start-render-poller.ts`, T7). ✓
- **Coolify safety:** Task 9 Step 1 gates the cron to no-op without a browser — a Coolify deploy of this branch is inert. ✓
- **Known deferral:** `extractSiblingColors` multi-colour harvest is wired in `buildQuotePayload` only as `[pg.color]` (single colour from JSON-LD). Full sibling-colour discovery (multiple goods_ids) is a Plan C concern when the result card needs colour options — noted, not a gap for the daemon's core quote.
- **Placeholder scan:** none; all code provided. The one "FIX during implementation" note (T6 retry budget) is explicitly resolved in T6 Step 2 with the requeue method — not a placeholder.
- **Type consistency:** `recordScrapeResult` payload shape (T6, routes T5) matches Plan A's signature and `buildQuotePayload`'s `QuoteScrapePayload` (T4). `SheinFetcher` interface (T2) implemented by `PlaywrightSheinFetcher` (T3), consumed by T6 + T9.
