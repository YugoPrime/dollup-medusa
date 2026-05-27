# Pre-order SHEIN bookmarklet + daily availability check — design

**Status:** **REVISED 2026-05-28 night**. Initial design assumed SHEIN ships a `window.gbProductSsrData` global; that's stale. Live probes against 3 real SHEIN URLs confirmed: (a) `gbProductSsrData` doesn't exist anywhere, (b) the canonical product data is `<script id="goodsDetailSchema" type="application/ld+json">` (JSON-LD `ProductGroup`), (c) sibling colors are discoverable via an inline `mainSaleAttribute.info[]` array embedded in another `<script>` block, (d) browser-context `fetch()` of sibling URLs works fine (anti-bot only blocks datacenter IPs). **See [Revision 2](#revision-2--2026-05-28-night) at the bottom of this doc — it supersedes the relevant sections of the original design.**

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

---

## Revision 2 — 2026-05-28 night

### What changed

The original design was built around `window.gbProductSsrData` — a SHEIN global that no longer exists. A live Playwright session on the 3 URLs the user supplied (Soleia tie-dye dress, Aloruh halter dress with 20 colors, Amorya ruffle dress) confirmed:

- **`window.gbProductSsrData`** — not present on any current SHEIN PDP. Only related global is `gbRawData`, which only contains `{googleSEO, modules, canonicalInfo}` — nothing about products.
- **JSON-LD `<script id="goodsDetailSchema">`** is present and stable. It's a `ProductGroup` containing `name`, `color` (single per page), `image[]` (6-8 high-res URLs), `hasVariant[]` with `size`, `offers.price`, and `offers.availability` per variant.
- **Each SHEIN URL represents ONE color.** Sibling colors live at different `goods_id`-numbered URLs. The list of siblings lives in an inline `<script>` containing a `mainSaleAttribute.info[]` array — each entry has `attr_value` (color name), `goods_id`, `goods_url_name`, `goods_color_image`, `goods_image`. URL pattern: `https://www.shein.com/<goods_url_name with spaces→hyphens>-p-<goods_id>.html`.
- **Browser-context `fetch()` of sibling URLs works fine** (1.5s, HTTP 200, full HTML returned). Anti-bot only blocks datacenter IPs (e.g. the Coolify backend container).
- **Server-side fetch from the backend container is blocked by SHEIN's risk/challenge** (302 to `/risk/challenge?captcha_type=903`). The daily availability cron strategy needs to assume blocking and fall back to a local-laptop daemon.

All verification artifacts saved at [`docs/superpowers/plans/2026-05-28-shein-probes/`](../plans/2026-05-28-shein-probes/) — probe JSON files numbered 01-08 trace the discovery path.

### Revised architecture

```
SHEIN PDP (your browser tab)
  ↓ click bookmarklet
  ↓ extracts JSON-LD ProductGroup from <script id="goodsDetailSchema">
  ↓   → title, color (current page's), image[], sizes, price, availability
  ↓ extracts mainSaleAttribute.info[] from inline <script>
  ↓   → list of all sibling color goods_id + goods_url_name
  ↓ in PARALLEL: fetch() each sibling URL in the same browser session
  ↓   → for each: parse its JSON-LD, get that color's image[]
  ↓ bundles current page + all siblings into one shape:
  ↓   { title, sheinUrl, sheinPriceUsd, sizes[], colors: [{name, sheinUrl, images[]}], bookmarkletVersion }
  ↓ POST https://api.dollupboutique.com/admin/preorder/bookmarklet
  ↓
Backend creates one Medusa product:
  ↓ variants = colors × sizes (e.g. 4 colors × 4 sizes = 16 variants)
  ↓ variant.metadata.image_urls = images for that color
  ↓ explicit remoteLink.create() for Pre-Order sales channel
  ↓
Bookmarklet toast: "Published ✓ Imported 4 colors, 16 variants → View"
```

### Revised data shapes

**`mainSaleAttribute.info[]` entry (extracted from inline `<script>`):**
```ts
type SheinColorEntry = {
  attr_id: "27"          // always 27 = Color attribute
  attr_value: string     // "Light Yellow"
  goods_id: string       // "373210897"
  goods_url_name: string // "Aloruh Women s Solid Color Casual Halter Mini Bubble Dress"
  goods_color_image: string  // swatch thumb
  goods_image: string        // main listing image (one only at this level)
}
```

**Sibling URL construction:**
```ts
function buildSheinUrl(entry: SheinColorEntry): string {
  const slug = entry.goods_url_name.trim().replace(/\s+/g, "-")
  return `https://www.shein.com/${slug}-p-${entry.goods_id}.html`
}
```

**JSON-LD ProductGroup (extracted from `<script id="goodsDetailSchema">`):**
```ts
type SheinJsonLd = {
  "@type": "ProductGroup"
  name: string
  color: string  // single color for THIS page
  productGroupID: string
  image: string[]  // 6-8 high-res URLs at .ltwebstatic.com
  hasVariant: Array<{
    "@type": "Product"
    sku: string
    size: string
    offers: {
      price: string  // USD, sometimes "0.00" if suppressed — bookmarklet falls back to DOM
      priceCurrency: "USD"
      availability: "https://schema.org/InStock" | "https://schema.org/OutOfStock"
    }
  }>
}
```

**Bookmarklet → backend payload (replaces the v1 shape):**
```ts
type BookmarkletImportBody = {
  title: string          // from the page where bookmarklet was clicked
  sheinUrl: string       // the page where bookmarklet was clicked
  sheinPriceUsd: number  // from JSON-LD or DOM fallback
  sizes: string[]        // union of sizes across all colors
  colors: Array<{
    name: string           // "Light Yellow"
    sheinUrl: string       // sibling URL for THIS color
    sheinGoodsId: string   // "373210897"
    images: string[]       // 6-8 URLs from THIS color's JSON-LD image[]
  }>
  bookmarkletVersion: string
}
```

### Multi-color sibling-fetch strategy

The bookmarklet's heaviest step is `Promise.all(colors.map(c => fetch(c.url).then(parseJsonLd)))`. Verified: 1 sibling takes 1.5s. With `Promise.all`, all N siblings finish in roughly the same time as the slowest one (≈2-3s typical for 4-5 colors).

**Limit:** Cap concurrent fetches at 8 (SHEIN may rate-limit too-aggressive parallel requests from one session). For products with >8 colors, queue the rest sequentially after the first batch.

**Failure modes:**
- One sibling 404s → skip that color, log it, keep others.
- One sibling's JSON-LD missing → skip that color, log it.
- All siblings fail → bookmarklet falls back to "current page only" → toast: "Imported 1 color only — N siblings failed to load".
- Captcha challenge fires mid-fetch → bookmarklet detects redirect-to-`/risk/challenge` in any response → aborts whole import, toast: "SHEIN anti-bot tripped. Wait 1 minute and try again."

### Daily availability check — strategy update

Server-side fetch from the backend container will hit the same `/risk/challenge` block. So the cron strategy becomes:

1. **Try server-side first** (cheap). Same 4xx detection logic as designed in v1.
2. **If >30% of products in one run get blocked** → fire the existing circuit-break Telegram alert AND tag those products with `metadata.shein_needs_manual_check = true` (not auto-drafted).
3. **Long-term: local-laptop daemon** — already documented as v2 fallback. Same pattern as the stories-render daemon. The daemon polls backend for `metadata.shein_needs_manual_check === true` products, visits them in a real browser session, posts availability back.

For v1, the daily cron ships server-side-only with Telegram alerts. The user accepts that anti-bot may make this useless and the laptop daemon is the realistic working solution — but that's deferred until we see the cron actually fail.

### Files affected by revision

The following plan tasks need code-level updates (file list unchanged from original, but contents change):

| Task | What changes |
|---|---|
| Task 1 (`shein-extract.ts`) | Drop `gbProductSsrData` paths entirely. Two new exports: `extractFromShein(html)` — parses `<script id="goodsDetailSchema">` JSON-LD only — and `extractMainSaleAttributeColors(html)` — parses the inline `mainSaleAttribute.info[]` array for sibling discovery. Both used by bookmarklet route validation + daily availability check. |
| Task 2 (`create-preorder-product.ts`) | Input shape `colors: Array<{name, sheinUrl, sheinGoodsId, images[]}>`. Each color stored on its variants' `metadata.image_urls`; `metadata.shein_url` on each variant tracks the sibling URL for color-specific availability checks. Product-level `metadata.shein_url` = the original page where the bookmarklet was clicked. |
| Task 12 (`/admin/preorder/bookmarklet` POST) | Validates new payload shape. Same auth, same workflow call, same channel-link logic. |
| Task 15 (bookmarklet JS) | Major rewrite. ~200 lines (was ~150). New extraction logic + `Promise.all` sibling fetch. |
| Task 20 (availability check job) | Reads JSON-LD `hasVariant[].offers.availability` instead of `gbProductSsrData.is_sold_out`. Checks each variant's sibling URL (via `metadata.shein_url`). If a SHEIN sibling 404s, mark just that color as unavailable on the Medusa product (set variant `manage_inventory: true, inventory_quantity: 0` for backend-side OOS — though actual policy is `manage_inventory=false` so we use a variant-level metadata flag instead). |

Tasks 3-11 and 13-19 + 21-22 are unchanged in shape (they cover token model, admin UI, telegram messages, etc.).

### Fixtures for tests

Tests use real captured data:
- [`docs/superpowers/plans/2026-05-28-shein-probes/07-aloruh-20-colors-parsed.json`](../plans/2026-05-28-shein-probes/07-aloruh-20-colors-parsed.json) — multi-color extraction (20 colors)
- [`docs/superpowers/plans/2026-05-28-shein-probes/02-aloruh-full-probe.json`](../plans/2026-05-28-shein-probes/02-aloruh-full-probe.json) — single-color JSON-LD (Aloruh = "Orange" only at the product-group level)
- [`docs/superpowers/plans/2026-05-28-shein-probes/03-amorya-full-probe.json`](../plans/2026-05-28-shein-probes/03-amorya-full-probe.json) — single-color JSON-LD
- [`docs/superpowers/plans/2026-05-28-shein-probes/08-sibling-fetch-success.json`](../plans/2026-05-28-shein-probes/08-sibling-fetch-success.json) — proof of cross-color browser-context fetch success

For the test fixtures the parser consumes (HTML strings), we'll save 2-3 representative HTML files captured live via Playwright when the implementation task runs (Task 1 first step).

### Security note

Multi-color import means the bookmarklet creates more product variants per click (e.g. 20 colors × 4 sizes = 80 variants). If the token is leaked, the abuser can spam-create much faster than before. Mitigations:
- Rate limit on the bookmarklet route: max 10 imports per token per hour (sliding window).
- Telegram alert on every bookmarklet POST (already designed) — abnormal volume becomes visible immediately.
- Token TTL stays at 90 days, single active token, revokable from admin.

### Things that stayed the same

- 3-phase rollout (per-color PDP → bookmarklet → daily cron)
- Token model + service + admin settings UI
- CORS allow-list for shein.com origins
- Hot-link SHEIN CDN images (no R2 mirror)
- Auto-publish (no review step before going live)
- Telegram message templates
- Daily 06:00 MU cron schedule
