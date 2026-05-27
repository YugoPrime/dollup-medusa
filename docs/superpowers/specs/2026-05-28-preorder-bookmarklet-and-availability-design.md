# Pre-order SHEIN bookmarklet + daily availability check — design

**Status:** Approved 2026-05-28, ready for implementation plan.
**Owner:** RahviB (solo).
**Repos touched:** `dollup-medusa` (backend), `dollup-admin` (admin UI), `DUB-front` (storefront).

## Problem

Today, every pre-order product is created by typing title, USD price, image URL, sizes, colors into the dollup-admin `/preorder` form. It's slow, error-prone, and one image per color is not enough — customers want front + back views before paying a 75% non-refundable deposit. There's also no automated way to catch products that have sold out on SHEIN — they stay published on `preorder.dollupboutique.com` until the owner manually notices.

## Goals (v1)

1. **One-click import from any SHEIN PDP** via a bookmarklet, including multi-image per color.
2. **Auto-publish** the imported product on `preorder.dollupboutique.com`.
3. **Daily availability check** that pulls each preorder product's SHEIN URL and moves the product to `status=draft` if SHEIN says out-of-stock or removed.
4. **PDP gallery follows selected color** — clicking a color swatch swaps the gallery to that color's images.

## Non-goals (v1, explicit)

- R2 image mirroring — hot-link SHEIN's CDN URLs only.
- Bulk paste of multiple URLs.
- Edit-before-publish review step (auto-publish chosen for speed).
- Chrome/Firefox extension (bookmarklet only).
- Customs / shipping cost tweaks (already handled).

## Architecture overview

```
SHEIN PDP (your browser tab)
  ↓ click bookmarklet
  ↓ reads window.gbProductSsrData
  ↓ extracts { title, sheinPriceUsd, sizes[], colors:[{name, images[]}] }
  ↓ POST https://api.dollupboutique.com/admin/preorder/bookmarklet
  ↓   header: x-preorder-bookmarklet-token: <plaintext>
  ↓
Backend route /admin/preorder/bookmarklet
  ↓ verify token (sha-256 hash compare against preorder_token row)
  ↓ runs same createProductsWorkflow + remoteLink.create as the admin form
  ↓ stores per-color images on variant.metadata.image_urls
  ↓ returns { product, storefrontUrl }
  ↓
Bookmarklet toast on SHEIN page: "Published ✓ View →"
```

Daily availability check is a Medusa v2 scheduled job:

```
06:00 MU every day → preorder-availability-check job
  for each preorder product (status=published):
    fetch metadata.shein_url server-side with realistic UA
    parse gbProductSsrData / JSON-LD
    branch on signal (in stock / out / 403 / 404 / parse-fail)
    update product + telegram alert on out / 404 / circuit-break
```

## Components

### Backend — `dollup-medusa`

**New module-level entity: `preorder_token`**
- `src/modules/preorder/models/preorder-token.ts`
- Columns: `id` (primary), `token_hash` (varchar, sha-256 hex), `created_at`, `expires_at` (nullable), `last_used_at` (nullable), `revoked_at` (nullable).
- Single active token at a time — generating a new one revokes the previous.

**Service additions: `src/modules/preorder/service.ts`**
- `generateBookmarkletToken({ expiresInDays = 90 })` → returns `{ tokenPlaintext, expiresAt }`. Plaintext shown ONCE.
- `verifyBookmarkletToken(plaintext)` → returns `{ valid: boolean; reason?: "revoked"|"expired"|"unknown" }`. Updates `last_used_at` on success.
- `revokeBookmarkletToken()` → sets `revoked_at = now()` on the active row.

**Migrations**
- `src/modules/preorder/migrations/Migration<timestamp>.ts` creates the `preorder_token` table.

**Routes**

`src/api/admin/preorder/bookmarklet/token/route.ts` (uses standard admin auth)
- `GET` → returns `{ active: boolean, expiresAt, lastUsedAt, revoked }` (NEVER the plaintext)
- `POST` → calls `generateBookmarkletToken()`, returns `{ token: <plaintext>, expiresAt }` — admin UI shows once
- `DELETE` → calls `revokeBookmarkletToken()`

`src/api/admin/preorder/bookmarklet/route.ts` (NO admin auth — token IS the auth)
- `POST` — body matches `BookmarkletImportBody` (see schema below), header `x-preorder-bookmarklet-token`
- Verifies token; if invalid → 401 with `{ reason }` so the bookmarklet can show a clear toast
- Reuses a shared helper `lib/create-preorder-product.ts` that contains the workflow logic (factored out of the existing `POST /admin/preorder/products` so both routes call the same code)
- Returns `{ product: { id, handle }, storefrontUrl }`

**Schema — `BookmarkletImportBody`**
```ts
{
  title: string                              // required, max 200
  sheinUrl: string                           // required, must match /^https?:\/\/(m\.)?shein\.com\//
  sheinPriceUsd: number                      // required, > 0
  sizes: string[]                            // required, may be ["One Size"]
  colors: Array<{                            // required, length >= 1
    name: string
    images: string[]                         // length >= 1, each url must match /^https:\/\/img\.ltwebstatic\.com\//
  }>
  bookmarkletVersion: string                 // semver-ish; backend logs if old
}
```

**Existing route extension: `src/api/admin/preorder/products/route.ts`**
- POST body accepts the new `colors: Array<{name, images}>` shape (backward-compat: old form sending `colors: string[]` + single `imageUrl` is mapped to `[{name: colors[i], images: [imageUrl]}]` so the existing admin form still works while it's not yet updated).
- Calls the shared `lib/create-preorder-product.ts` helper.

**Shared helper: `src/api/admin/preorder/lib/create-preorder-product.ts`**
- Takes the normalized `colors: Array<{name, images}>` shape.
- Computes variants from `colors × sizes`.
- Per variant, sets `metadata.image_urls = colors[i].images` so the PDP can read per-color images.
- Sets `thumbnail = colors[0].images[0]`.
- Sets product-level `images = colors.flatMap(c => c.images.map(url => ({url})))` (Medusa needs a flat list — variant.metadata.image_urls is the per-color source of truth for the storefront).
- Runs `createProductsWorkflow` with the same shape as today.
- After product creation, runs `remoteLink.create({ PRODUCT, SALES_CHANNEL })` explicitly (the workflow's own `sales_channels` input silently no-ops — already documented in the 2026-05-27 fix).

**Daily availability check: `src/jobs/preorder-availability-check.ts`**
- Medusa v2 scheduled job; cron pattern `0 6 * * *` (Mauritius local time — backend already runs in `TZ=Indian/Mauritius`).
- Fetches all products with `metadata.is_preorder === true` AND `status === "published"`.
- For each: `fetch(metadata.shein_url)` with `User-Agent: Mozilla/5.0 (...)` matching a real Chrome string, 10s timeout, 3 retries with exponential backoff.
- Parses response via `lib/shein-extract.ts` (shared with bookmarklet route's validation).
- Decision matrix:

| Signal from SHEIN | Action |
|---|---|
| 200 + at least one variant has `is_on_sale === 1` AND `stock > 0` in `productIntroData.detail.sku_relation_info` | update `metadata.last_shein_check = now`, clear `shein_check_failures` |
| 200 but ALL variants have `stock === 0` OR `is_sold_out === 1` at the product level OR JSON-LD `availability` === "OutOfStock" | `status = draft`, `metadata.shein_unavailable = true`, Telegram alert |
| 404 | `status = draft`, `metadata.shein_removed = true`, Telegram alert |
| 403/429 (anti-bot block) | increment `metadata.shein_check_failures`; if ≥ 3 consecutive, Telegram "manual check needed" |
| Network error / parse fail | increment `metadata.shein_check_failures`; alert at threshold |

- After loop: if >30% of checks failed with anti-bot signals, a single Telegram message: "Daily SHEIN check mostly failed — anti-bot block likely. Run bookmarklet manually for these N products: <list>".
- Telegram messages use the existing `lib/telegram.ts` helper (from order notifications).

**Shared parser: `src/lib/shein-extract.ts`**
- Takes an HTML string (from server-side fetch) OR the already-parsed `gbProductSsrData` object (from bookmarklet client-side).
- Returns `{ title, sheinPriceUsd, sizes, colors: [{name, images}], stockAvailable }` — same normalized shape used everywhere.
- Fallback chain: `gbProductSsrData` → JSON-LD `<script type="application/ld+json">` → DOM scrape — though for the daily cron only the first two are practical (server-side has no DOM).

### Admin UI — `dollup-admin`

**Page: `src/app/settings/preorder-bookmarklet/page.tsx`**
- Top panel: status (active / no token / revoked / expired), "Generate new token" button, "Revoke" button.
- After generating: shows the token (one-time display, copy button) + the full bookmarklet code with the token already baked in + a draggable `<a>` link "Drag to bookmarks bar" (browser-native bookmarklet install pattern).
- Below: usage instructions ("Go to any SHEIN product page → click the bookmark → wait for the green toast").

**Bookmarklet source: `public/preorder-bookmarklet.js`**
- A regular `.js` file (so it's git-trackable and reviewable). The admin page reads this file at build time, inlines the token, minifies, and renders as `javascript:...`.
- Structure (~150 lines source, ~5KB minified):
  ```
  (function () {
    const TOKEN = "<INJECTED>";
    const API = "https://api.dollupboutique.com/admin/preorder/bookmarklet";
    const VERSION = "1.0.0";

    function extract() { /* read gbProductSsrData → normalized shape */ }
    function fallback() { /* JSON-LD scan */ }
    function toast(message, kind) { /* show overlay */ }

    try {
      const data = extract() || fallback();
      if (!data) { toast("Couldn't read this SHEIN page", "error"); return; }
      toast("Publishing…", "info");
      fetch(API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-preorder-bookmarklet-token": TOKEN,
        },
        body: JSON.stringify({ ...data, bookmarkletVersion: VERSION }),
      })
        .then((r) => r.json().then((j) => ({ ok: r.ok, body: j })))
        .then(({ ok, body }) => {
          if (!ok) { toast("Failed: " + (body.message || "unknown"), "error"); return; }
          toast(`Published ✓ View → ${body.storefrontUrl}`, "success");
        })
        .catch((err) => toast("Failed: " + err.message, "error"));
    } catch (err) {
      toast("Bookmarklet error: " + err.message, "error");
    }
  })();
  ```

### Storefront — `DUB-front`

**Type extension: `src/lib/preorder.ts`**
- `PreorderProduct.variants[i]` gains `metadata: { image_urls?: string[] } | null` (read at PDP).

**PDP rewrite: `src/app/(preorder)/preorder/products/[handle]/page.tsx`**
- Reads color groups from variants (group by `variant.options.find(o => o.option.title === "Color").value`).
- Renders a `<PreorderGallery>` client component + a color-swatch row that emits `PDP_COLOR_CHANGE_EVENT` (same event pattern as apex PDP).
- Default selected color = the first color (all variants are `manage_inventory=false`, so "stock" doesn't apply).

**New component: `src/components/preorder/PreorderGallery.tsx`** (client)
- Receives `colorImageMap: Record<colorName, string[]>` + initial color.
- Listens to `PDP_COLOR_CHANGE_EVENT`; when fired, swaps to that color's images.
- Renders main image + a thumbnail strip below (mobile: horizontal scroll, desktop: vertical column).

**No changes to checkout/cart** — variant IDs flow through normally; per-color images are display-only.

### CORS update (Coolify env, not code)

`ADMIN_CORS` env var must include the SHEIN origins:
```
ADMIN_CORS=https://dollup-admin.dollupboutique.com,https://shein.com,https://www.shein.com,https://m.shein.com,https://us.shein.com
```

The bookmarklet route also needs `Access-Control-Allow-Headers` to include `x-preorder-bookmarklet-token` — Medusa's CORS middleware allows arbitrary `x-*` headers by default; verified manually post-deploy.

## Data flow examples

**Happy path — bookmarklet import:**
1. You open `https://www.shein.com/Floral-Dress-p-12345.html`.
2. Click bookmarklet.
3. `extract()` reads `window.gbProductSsrData.productIntroData` → `{title: "Floral Dress", priceUsd: 22, sizes: ["S","M","L","XL"], colors: [{name: "Beige", images: [4 urls]}, {name: "Black", images: [3 urls]}]}`.
4. POST to `/admin/preorder/bookmarklet` with token.
5. Backend verifies token, calls `createPreorderProduct({...})` helper. Helper creates 8 variants (2 colors × 4 sizes), sets per-variant `metadata.image_urls`, links to Pre-Order sales channel.
6. Bookmarklet shows toast: `Published ✓ View → preorder.dollupboutique.com/preorder/products/floral-dress-preorder-abc123`.
7. Within 60s (RSC revalidate), storefront `/preorder` lists it.

**Daily availability check — product sold out:**
1. 06:00 MU, cron fires.
2. Job lists 12 published preorder products.
3. For product #5 (a beachwear set), backend fetches its SHEIN URL.
4. SHEIN returns 200 but `gbProductSsrData.stockAvailable === false`.
5. Job updates product: `status = "draft"`, `metadata.shein_unavailable = true`, `metadata.last_shein_check = "2026-05-28T02:00:00Z"`.
6. Telegram message: `🚨 Pre-order moved to draft: Beachwear Set — SHEIN sold out → https://shein.com/...`.
7. Storefront revalidates within 60s, product disappears from listing & PDP `notFound()`.
8. You decide later: regenerate via bookmarklet on a similar SHEIN item, or delete entirely.

## Error handling

| Failure | Behavior |
|---|---|
| Bookmarklet on non-SHEIN page | toast "Not a SHEIN page" |
| `gbProductSsrData` not found AND JSON-LD missing | toast "Couldn't read this page — open admin manually" with link to `/preorder/new` |
| Backend 401 (token expired/revoked) | toast "Token expired. Regenerate in /settings/preorder-bookmarklet" |
| Backend 400 (validation) | toast "Failed: <field> — <message>" |
| Backend 5xx | toast "Backend error — try again" + log digest |
| Daily cron: SHEIN returns 403/429 | retry with backoff; after 3 failures, log + Telegram |
| Daily cron: >30% of products got blocked | single Telegram circuit-break alert; do NOT mass-draft |

## Security

- Token is hashed at rest (sha-256). Plaintext shown ONCE on generation.
- Token leak impact: anyone with the URL can create AND publish preorder products on the storefront. **Acceptable trade-off given auto-publish was explicitly chosen over draft+review.** Mitigations: 90-day default expiry, single active token (regenerating revokes the old), revoke button in UI, Telegram alert on every bookmarklet POST so misuse is visible immediately.
- Bookmarklet runs in SHEIN's origin context, so SHEIN's JS COULD theoretically intercept the click — only relevant if SHEIN itself becomes adversarial, accepted risk.
- The CORS allow-list deliberately whitelists only the SHEIN origins to limit the blast radius.

## Testing strategy

**Backend unit tests:**
- `src/modules/preorder/__tests__/token-service.spec.ts` — generate, verify happy + wrong + expired + revoked; regenerate revokes previous.
- `src/lib/__tests__/shein-extract.spec.ts` — fixture HTML files from 3-5 real SHEIN PDPs (dress with size+color, top with size only, accessory with single color, sold-out product, removed/404 placeholder). Each fixture lives in `__tests__/fixtures/shein/<name>.html`. Asserts normalized shape matches.
- `src/api/admin/preorder/__tests__/bookmarklet-route.spec.ts` — integration test: valid token + valid body → product created, channel linked, per-color metadata present. Invalid token → 401. Expired token → 401. Malformed body → 400.

**Daily cron tests:**
- `src/jobs/__tests__/preorder-availability-check.spec.ts` — mock `fetch` to return each branch (in-stock / out / 404 / 403 / network error). Assert product status changes + Telegram messages fire correctly.

**Manual smoke (post-deploy):**
1. Generate token in admin, drag bookmarklet to bookmarks.
2. Open 2 different SHEIN PDPs (one multi-color, one single-color). Click bookmarklet on each.
3. Verify both appear on `preorder.dollupboutique.com` within 60s.
4. Open the multi-color one → click each color swatch → verify gallery swaps.
5. On the backend container: `yarn medusa exec ./src/scripts/run-availability-check-now.ts` (one-shot helper for manual triggering). Verify Telegram fires for products that are out-of-stock.

## Rollout order

1. **Phase 1 — Per-color images on existing admin form** (extends current POST, builds shared helper). Ships PDP gallery follows color. No bookmarklet yet.
2. **Phase 2 — Token + bookmarklet route + admin settings page**. Ships the bookmarklet itself.
3. **Phase 3 — Daily availability check job + Telegram alerts.**

Each phase is its own commit + Coolify deploy, smoke-tested in isolation. Failure isolation: if phase 2 has a bug, phase 1 still works (admin form unchanged).

## Open items / v2 candidates (NOT in v1)

- **R2 image mirror** — wait for first real SHEIN-CDN-broke-our-PDP incident.
- **Local-laptop availability check** — if server-side cron gets persistently blocked by SHEIN, build a local daemon (same pattern as `start-render-daemon.ps1` for stories). Daemon polls backend DB, visits SHEIN URLs from your IP, posts status back. Documented as fallback path in `docs/LOCAL-AVAILABILITY-DAEMON-SETUP.md` (file created when needed).
- **Bulk-paste UI** for old products you want to backfill — defer until you actually have 50+ products from old SHEIN curation to import.
- **Edit-before-publish overlay** — defer until typo-in-published-product bites you.
- **iOS Safari bookmarklet support** — should work in theory (Safari supports bookmarklets), untested.
- **Auto-detect color fallback to manual mapping** — if SHEIN's `gbProductSsrData` color structure changes, build the "click each color manually" flow described in original brainstorm option.

## Files touched (summary)

**`dollup-medusa` (backend):**
- new: `src/modules/preorder/models/preorder-token.ts`
- new: `src/modules/preorder/migrations/Migration<ts>.ts`
- modified: `src/modules/preorder/service.ts` (+3 methods)
- new: `src/api/admin/preorder/bookmarklet/route.ts`
- new: `src/api/admin/preorder/bookmarklet/token/route.ts`
- modified: `src/api/admin/preorder/products/route.ts` (accepts new `colors[{name,images}]` shape)
- new: `src/api/admin/preorder/lib/create-preorder-product.ts` (shared helper)
- new: `src/lib/shein-extract.ts`
- new: `src/jobs/preorder-availability-check.ts`
- new: `src/scripts/run-availability-check-now.ts` (manual one-shot)
- new tests under each `__tests__/` folder

**`dollup-admin`:**
- new: `src/app/settings/preorder-bookmarklet/page.tsx`
- new: `public/preorder-bookmarklet.js`
- modified: settings nav to link the new page

**`DUB-front`:**
- modified: `src/lib/preorder.ts` (type extension)
- modified: `src/app/(preorder)/preorder/products/[handle]/page.tsx` (color swatch row)
- new: `src/components/preorder/PreorderGallery.tsx`
