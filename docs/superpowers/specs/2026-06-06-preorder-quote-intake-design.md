# Pre-order quote intake — design spec

**Date:** 2026-06-06
**Status:** Approved (brainstorm), pending implementation plan
**Repos touched:** `dollup-medusa` (backend + daemon), `DUB-front` (storefront), `dollup-admin` (admin)
**Supersedes the paused brainstorm** captured in memory `preorder-quote-intake-paused-2026-05-29`.

---

## 1. Problem & goal

Today a client who finds a SHEIN item DMs the link on WhatsApp; the owner manually
opens it, computes the all-in MUR price, and replies. Goal: replace the *quote* step
with an on-site flow. Client pastes up to 5 SHEIN links on `/preorder/request`, gets
an all-in price per item, picks size/colour, reserves with the existing 75% deposit
checkout — all without a manual round-trip in the happy path.

This feature **hands off to** the already-merged `/preorder/checkout` + deposit
provider (`feat/preorder-checkout`, merged to master 2026-06-02). That dependency is
satisfied; this spec builds on top of it.

## 2. Hard constraint that shapes everything: SHEIN JS captcha

As of 2026-06 SHEIN serves a JS captcha challenge (`/risk/challenge`, captcha_type
903/909) to **every plain server-side fetch** — confirmed even from a residential IP
with full browser headers; a datacenter IP (Coolify) is blocked harder. **Plain
`fetch()` can no longer read a SHEIN PDP.** The existing daily availability cron
(`src/jobs/preorder-availability-check.ts`) is therefore currently broken — it
classifies every product as `blocked`.

**Decision:** all SHEIN PDP reads move to a **headless-browser daemon** on the owner's
laptop (Playwright + real Chromium, which executes the JS challenge), using the same
Task Scheduler supervision pattern as the stories renderer
(see memory `feedback-windows-daemons-use-task-scheduler`). Free, no new vendor to vet
(respects the pre-install vetting rule), reuses a proven operational pattern.

A paid scraping API was considered and deferred. To keep that door open, the scrape
call sits behind a `SheinFetcher` interface (one method: `fetchPdpHtml(url) → html`),
so a cloud/API implementation can replace the laptop one later without rearchitecting.
**v1 ships the laptop implementation only.**

## 3. Architecture

```
[/preorder/request page]
   client pastes ≤5 SHEIN links + WhatsApp number
          │  POST /hooks/preorder-quote  (token-authed, no Medusa auth namespace)
          ▼
[Backend: PreorderQuoteRequest + N PreorderQuoteItem rows]   status=pending
          │
          │  (daemon-offline check: if no daemon heartbeat in 5 min,
          │   items go straight to needs_manual + Telegram ping)
          ▼
[Storefront polls GET /store/preorder-quote/:id]  ──▶ cards stream from
   pending → quoted / needs_manual / failed                  the row states

          ▲                                   ▲
          │ POST result                       │ GET jobs / PATCH claim
          │                                   │
   ┌──────┴───────────────────────────────────┴──────┐
   │   SHEIN headless daemon (laptop, Task Scheduler)  │
   │   Playwright real Chromium → solves /risk/challenge│
   │   reuses lib/shein-extract.ts (JSON-LD + siblings) │
   │   reuses modules/preorder/lib/pricing.ts (USD→MUR) │
   │   TWO job types:                                   │
   │     (a) quote jobs  — this feature                 │
   │     (b) availability sweep — ports the broken cron │
   └───────────────────────────────────────────────────┘
```

**One scrape engine, two consumers.** The daemon's Playwright browser serves both the
client-triggered quote jobs and the daily availability sweep (which moves off Coolify
plain-fetch onto the daemon). The pure parser (`shein-extract.ts`) and pricing
(`pricing.ts`) are unchanged and reused as-is.

## 4. Data model

Two new entities in the existing `preorder` module (alongside `PreorderSettings`,
`PreorderToken`). Linkable keys camelCase: `module.linkable.preorderQuoteRequest` /
`preorderQuoteItem` (see memory `medusa-v2-linkable-keys`).

### `PreorderQuoteRequest` — one row per client submission
- `id` `pqreq_*`
- `contact` jsonb `{ whatsapp, name? }`
- `status` enum: `pending | quoted | partial | needs_manual | reserved | expired | abandoned`
- `notes` text nullable
- `items_count` int
- `client_ip` text (for rate-limiting)
- `reserved_cart_id` text nullable
- `expires_at` = `created_at + 48h`

### `PreorderQuoteItem` — N rows per request
- `id` `pqitem_*`
- `request_id` FK — `hasMany(..., { mappedBy: "request" })` (memory `medusa-v2-hasmany-mappedby`)
- `position` int
- `shein_url` text
- **Job state:** `status` enum `pending | scraping | quoted | needs_manual | failed | reserved`;
  `attempts` int; `locked_at` timestamptz nullable (stale-lock reclaim);
  `last_attempt_at`; `last_error_kind` enum `challenge | removed | parse-fail | network-error | timeout | invalid-url`
- **Scrape result:** `scraped_title`, `scraped_thumbnail`, `scraped_price_usd`,
  `color_options` jsonb (sibling colours, same shape the bookmarklet harvests),
  `size_options` jsonb
- **Pricing:** `all_in_price_mur` int (binding quoted price), `price_breakdown` jsonb
  (full `ComputePreorderPriceResult`), `fx_rate_used`,
  `settings_snapshot` jsonb (immutable `PreorderSettingsLike` at quote time)
- **Client selection:** `selected_size` text nullable, `selected_color` text nullable
- **Reserve:** `reserved_product_id` text nullable, `reserved_at` timestamptz nullable

> Migration note: do NOT `ON CONFLICT` against a unique index created in the same
> transaction (memory `medusa-migration-on-conflict-same-tx-fails`); use
> `WHERE NOT EXISTS`.

### Daemon heartbeat
A single `shein_daemon_last_seen_at` timestamptz field on the existing
`PreorderSettings` row (not a new table — there's exactly one settings row, and the
heartbeat is singleton state). Written by the daemon every poll.

## 5. Service additions (extend `modules/preorder/service.ts`)

- `createQuoteRequest({ contact, urls[], clientIp, notes }) → { requestId, items[] }`
  — validates URLs (shein.com regex), enforces ≤5 links + per-IP rate limit,
  writes request + items. If daemon heartbeat is stale (>5 min), creates items
  directly as `needs_manual`.
- `getQuoteRequest(id, { withItems: true })` — storefront poll + admin detail.
- `listQuoteJobs({ status, limit })` — daemon poll (default `status=pending`).
- `claimQuoteJob(itemId) → bool` — atomic lock: set `scraping`, `locked_at`,
  `attempts++`. A `scraping` job with `locked_at` older than 5 min is reclaimable.
- `recordScrapeResult(itemId, payload)` — writes scrape fields + price snapshot,
  sets `quoted`/`failed`/`needs_manual`, bubbles request status (all quoted →
  `quoted`; mix → `partial`; all manual → `needs_manual`).
- `setManualQuote(itemId, { priceUsd })` — admin inline quote: runs `previewPrice`,
  writes snapshot, sets `quoted`. (Reuses `pricing.ts`; mirrors daemon result.)
- `selectQuoteItemOptions(itemId, { size, color })` — client size/colour pick.
- `reserveQuoteItem(itemId) → { productId, variantId }` — lazy product creation
  (see §8), idempotent.
- `recordDaemonHeartbeat()` — daemon liveness.
- `expireOldRequests()` — cron, marks unreserved >48h `expired`.

## 6. Storefront UX (`DUB-front`, sage palette / preorder host)

Replaces the current Phase-1 placeholder at
`src/app/(preorder)/preorder/request/page.tsx`.

**Form (decision: single textarea, "B"):** one textarea, paste links one-per-line
(≤5) + WhatsApp number. Size/colour are NOT entered up front — they're chosen on each
result card after the quote loads (the daemon scrapes the real available options).

**Submit → results stream.** Each link becomes a card. The page polls
`GET /store/preorder-quote/:id` and renders per-card states:

1. **scraping** — skeleton + "Getting your price… usually under a minute"
2. **quoted** — thumbnail, all-in `Rs X,XXX`, deposit/balance split, size chips to
   pick, `Reserve · Rs <deposit>` button
3. **needs_manual / failed** — soft fallback card "We'll quote this by hand" +
   "Send this to us on WhatsApp" deep-link (`removed` → "no longer on SHEIN")
4. **reserved** — collapses to a compact "in your cart" row with a check

**Sticky bottom bar:** "N of M reserved · Rs <total> deposit → Checkout all" →
the merged `/preorder/checkout`.

**Daemon-offline UX:** if items are created `needs_manual` (stale heartbeat), the card
shows state 3 immediately — never an indefinite spinner.

Reuse `formatPrice(amount, "MUR")` and `computeDepositSplit` (already whole-rupee
in/out — memory `sourcing-push-100x-price-bug-fixed-2026-06-03`). Preorder thumbnails
use plain `<img>`, not `next/image` (same memory — custom loader 404s non-CDN hosts).

### 6a. Price simulator (inline widget, top of `/preorder/request`)

A small "Estimate your price" widget above the link form: client types the SHEIN
**USD** price → instantly sees the **all-in MUR** price + deposit/balance split. No
scrape, no daemon — pure pricing math, so it works even when the daemon is offline and
before any link is pasted. Sets price expectations up front to reduce sticker-shock
abandonment.

- **Backend:** new public store route `GET /store/preorder/price-preview?usd=<n>`
  (or POST), mirroring the existing admin `src/api/admin/preorder/price-preview/route.ts`
  — calls `previewPrice` and returns `{ finalPriceMur, depositMur, balanceMur, breakdown }`.
  No auth (read-only, no PII), but clamp `usd` to the same `0 < usd <= 10000` bound the
  bookmarklet validator uses.
- **Frontend:** a client component with a USD input, debounced; renders
  `formatPrice(finalPriceMur, "MUR")` + deposit/balance via the same `computeDepositSplit`
  the result cards use. Reused as the same display primitive as a quoted card, minus the
  scrape.
- The settings used are **live** settings (not snapshotted) — this is an estimate, not a
  binding quote. Copy should say "estimate"; the binding price only comes from an actual
  quote.

## 7. Admin surface (`dollup-admin`, `/preorder/requests`)

Master-detail on one page (Medusa admin styling):
- **Left:** request list + status filter chips — **All / Needs me / Reserved / Expired**.
  "Needs me" (any `needs_manual` item) is the daily work queue.
- **Right (detail):** contact + WhatsApp link + 48h expiry countdown; per item:
  - **quoted** — read-only (price, source = daemon/manual, size)
  - **needs_manual** — two resolutions: (a) "Open in SHEIN + extension" deep-link
    (the bookmarklet path), or (b) inline USD entry → runs `pricing.ts` live → shows
    all-in Rs → "Push quote to client" (`setManualQuote`).
- Expired/abandoned requests stay visible, greyed.

## 8. Reserve → cart (uses merged checkout)

On **Reserve** (quoted card, size selected):

1. **Lazy product creation** — if `reserved_product_id` is null, call the existing
   `createPreorderProduct` (`src/api/admin/preorder/lib/create-preorder-product.ts`)
   with the item's scraped data (title, colour+image, sizes, USD price). It builds
   variants, prices (the 100x bug is fixed — memory same ref), creates the product,
   links the Pre-Order channel, returns it. Store `reserved_product_id` + `reserved_at`.
   If non-null already (second size / re-click), **reuse** — no duplicate product.
2. **Catalog visibility (decision: hidden):** `createPreorderProduct` gains an optional
   `hideFromCatalog` param → writes `metadata.hide_from_catalog = true`. The
   `/preorder/products` grid query excludes that flag, so reserved products are
   reservable + checkout-able by direct link but absent from the public grid until the
   owner chooses to feature one. Product stays `status: "published"` (a `draft` product
   can't be carted in Medusa v2) — the flag, not the status, hides it.
3. **Add to cart** — add the size/colour variant to the preorder cart, same path as
   `PreorderProductCard`. Cart drawer + checkout already branch on cart type
   (`52ecefd`).
4. **Checkout all** → merged `/preorder/checkout`. No new checkout code.

The `settings_snapshot` makes the quoted price binding: even if the owner edits
fx-rate/handling between quote and reserve, the client pays what they saw.

## 9. Daemon (`dollup-medusa`, new — `scripts/shein-daemon/` + Task Scheduler)

- Playwright + real Chromium. Two job loops:
  - **Quote loop:** poll `GET /admin/preorder/quote-jobs?status=pending&limit=5`
    (token-authed, bookmarklet-token pattern). For each: `claimQuoteJob` → load PDP in
    Chromium (solve challenge) → `extractJsonLd` + `extractSiblingColors` on the
    rendered HTML → `previewPrice` → `POST .../quote-jobs/:id/result`. Retry budget
    **3**, then `needs_manual`. `recordDaemonHeartbeat` each poll.
  - **Availability sweep:** the daily check (currently broken) runs here through the
    same browser, replacing the Coolify plain-fetch path in
    `preorder-availability-check.ts`. The classification/Telegram logic is unchanged;
    only the fetch is swapped to the daemon's browser.
- Polling cadence ~30s during waking hours (09:00–22:00 MU); cadence tunable.
- **Endpoints (contract):**
  - `GET  /admin/preorder/quote-jobs?status=&limit=`
  - `PATCH /admin/preorder/quote-jobs/:id/claim`
  - `POST /admin/preorder/quote-jobs/:id/result`
  - heartbeat folded into the poll (or a `POST .../daemon/heartbeat`)
- **Doc:** write `docs/LOCAL-SHEIN-DAEMON-SETUP.md` (the missing
  `LOCAL-AVAILABILITY-DAEMON-SETUP.md` the Telegram alert links to — same doc,
  renamed for the unified daemon).

## 10. Failure modes, rate-limiting, expiry

- **Daemon offline:** heartbeat stale >5 min → new items created `needs_manual` +
  Telegram ping; storefront shows the by-hand card immediately (no infinite spinner).
- **Rate-limit:** ≤5 links per request; **≤5 requests per IP per hour** (loosened from
  3 because Mauritius carrier-grade NAT shares IPs across many real users). Over →
  soft "message us on WhatsApp" nudge.
- **URL validation:** must match the bookmarklet's `shein.com/...` regex, client + server.
- **Per-item kinds:** `removed` (404) → dead, "no longer on SHEIN", no fallback;
  `challenge`/retries-exhausted → `needs_manual`; `parse-fail` → `needs_manual` +
  Telegram (signals SHEIN markup drift).
- **Expiry:** `expires_at = created_at + 48h`; `expireOldRequests` cron marks
  unreserved-past-48h `expired`; reserved items exempt; expired still visible in admin.

## 11. Reuse map (what already exists)

| Need | Reuse |
|------|-------|
| SHEIN PDP parse (title/image/size/price/availability) | `src/lib/shein-extract.ts` (unchanged) |
| Sibling-colour discovery | `extractSiblingColors` (unchanged) |
| USD→MUR all-in pricing | `modules/preorder/lib/pricing.ts` (unchanged) |
| Price simulator math | `previewPrice` + new public `/store/preorder/price-preview` mirroring admin route |
| Product + variant + channel-link creation | `api/admin/preorder/lib/create-preorder-product.ts` (+ `hideFromCatalog` param) |
| Deposit split (75%, round Rs 50) | `computeDepositSplit` (DUB-front) |
| Deposit checkout + provider | merged `/preorder/checkout` (`feat/preorder-checkout`) |
| Daily availability classify + Telegram | `jobs/preorder-availability-check.ts` (fetch swapped to daemon) |
| Daemon supervision | Task Scheduler pattern (stories renderer) |
| Token auth for daemon/hook | bookmarklet token (`PreorderToken`) |

## 12. Out of scope (v1)

- Paid scraping API (interface stub only; laptop impl ships).
- Auto-publish reserved products to catalog (manual curation step instead).
- Email notifications (no notification provider configured).
- Multi-currency / non-MU.
- Discount codes on preorder deposits.
