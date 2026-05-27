# Pre-order SHEIN bookmarklet + daily availability check — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-typed pre-order admin form with a one-click SHEIN bookmarklet that auto-publishes products with per-color images, and add a daily cron that moves sold-out SHEIN products to draft.

**Architecture:** Three phases shippable independently. Phase 1 extends the existing admin POST to accept per-color image arrays and updates the PDP gallery to follow the selected color. Phase 2 adds a token-authed `/admin/preorder/bookmarklet` route, a personal-token model, an admin settings page, and the bookmarklet JS itself. Phase 3 adds a daily Medusa job that pings each preorder product's SHEIN URL and moves it to draft on out-of-stock / 404. All three reuse a shared `lib/shein-extract.ts` parser and a shared `lib/create-preorder-product.ts` workflow helper.

**Tech Stack:** Medusa v2.13.1 (modules, models, migrations, scheduled jobs), TypeScript 5, MikroORM, Jest. Storefront Next.js 16 (App Router, RSC). Admin Next.js + Medusa admin SDK. Telegram via existing `lib/telegram.ts`.

**Spec:** [`docs/superpowers/specs/2026-05-28-preorder-bookmarklet-and-availability-design.md`](../specs/2026-05-28-preorder-bookmarklet-and-availability-design.md)

---

## File map — what each new/modified file owns

**Backend (`Backend/dollup-medusa/`):**

| File | Responsibility | Phase |
|---|---|---|
| `src/lib/shein-extract.ts` | Pure parser. Given an HTML string OR a parsed `gbProductSsrData` object, returns the normalized `{title, sheinPriceUsd, sizes, colors:[{name,images}], stockAvailable}` shape. Fallback chain: `gbProductSsrData` → JSON-LD. | 1 |
| `src/lib/__tests__/shein-extract.spec.ts` | Unit tests over 5 fixture HTML files. | 1 |
| `src/api/admin/preorder/lib/create-preorder-product.ts` | Shared helper. Takes normalized `{title, sheinPriceUsd, sizes, colors[{name,images}], sheinUrl}`, computes variants, runs `createProductsWorkflow`, runs explicit `remoteLink.create` for Pre-Order sales channel. Returns `{id, handle}`. | 1 |
| `src/api/admin/preorder/products/route.ts` | Existing POST refactored to call the shared helper. Accepts both legacy `{colors: string[], imageUrl}` AND new `{colors: [{name,images}]}` shapes. | 1 |
| `src/modules/preorder/models/preorder-token.ts` | Token table model. | 2 |
| `src/modules/preorder/migrations/Migration20260528000000.ts` | Creates `preorder_token` table. | 2 |
| `src/modules/preorder/service.ts` | +3 methods: `generateBookmarkletToken`, `verifyBookmarkletToken`, `revokeBookmarkletToken`. | 2 |
| `src/modules/preorder/__tests__/token-service.spec.ts` | Unit tests for the 3 token methods. | 2 |
| `src/api/admin/preorder/bookmarklet/token/route.ts` | Admin-auth route: GET status, POST generate, DELETE revoke. | 2 |
| `src/api/admin/preorder/bookmarklet/route.ts` | Token-auth route: POST imports a product. NO admin auth middleware. | 2 |
| `src/api/middlewares.ts` | Add a middleware entry that disables admin auth on `/admin/preorder/bookmarklet`. | 2 |
| `src/jobs/preorder-availability-check.ts` | Daily cron. Iterates preorder products, fetches SHEIN URL, parses, updates status + alerts. | 3 |
| `src/scripts/run-availability-check-now.ts` | One-shot manual trigger of the job logic for smoke. | 3 |

**Admin UI (`dollup-admin/`):**

| File | Responsibility | Phase |
|---|---|---|
| `src/app/settings/preorder-bookmarklet/page.tsx` | Generate/revoke token UI + draggable bookmarklet link. | 2 |
| `public/preorder-bookmarklet.js` | Bookmarklet source (un-minified, git-trackable). | 2 |
| `src/lib/build-bookmarklet.ts` | Server-only helper: reads the JS file, inlines the token, minifies, returns `javascript:...` href. | 2 |

**Storefront (`DUB-front/`):**

| File | Responsibility | Phase |
|---|---|---|
| `src/lib/preorder.ts` | `PreorderProduct` type extended: `variants[i].metadata.image_urls`. | 1 |
| `src/components/preorder/PreorderGallery.tsx` | Client component. Main image + thumbnail strip. Listens to `PDP_COLOR_CHANGE_EVENT`, swaps images. | 1 |
| `src/components/preorder/PreorderColorSwatches.tsx` | Client component. Renders color buttons, fires `PDP_COLOR_CHANGE_EVENT`. | 1 |
| `src/app/(preorder)/preorder/products/[handle]/page.tsx` | PDP wires up gallery + swatches + per-color price/sizes. | 1 |

---

# Phase 1 — Per-color images on existing admin form

Goal: refactor the existing POST to use a shared helper, accept per-color image arrays, and make the PDP gallery follow the selected color. Bookmarklet not built yet — the existing admin form still works.

## Task 1: Build the shared SHEIN parser (lib/shein-extract.ts)

**Files:**
- Create: `Backend/dollup-medusa/src/lib/shein-extract.ts`
- Create: `Backend/dollup-medusa/src/lib/__tests__/shein-extract.spec.ts`
- Create: `Backend/dollup-medusa/src/lib/__tests__/fixtures/shein/dress-multicolor.html` (real HTML snippet — see step 1)
- Create: `Backend/dollup-medusa/src/lib/__tests__/fixtures/shein/single-color.html`
- Create: `Backend/dollup-medusa/src/lib/__tests__/fixtures/shein/sold-out.html`

- [ ] **Step 1: Capture 3 real SHEIN PDP fixtures**

In your browser, open 3 SHEIN PDPs of different shapes:
1. A dress with multiple colors AND multiple sizes (e.g. the "Strapless Shirred Pleated" you already imported)
2. A product with a single color + sizes (a top in only "Black")
3. A product currently marked sold out

For each: View source → save as the corresponding fixture file. The fixtures only need the `<script>` tag that contains `window.gbProductSsrData = {...}` plus any `<script type="application/ld+json">` blocks — strip the rest to keep fixtures small.

These fixtures are the test contract. Keep them on disk forever; if SHEIN changes structure the failing tests tell us exactly where.

- [ ] **Step 2: Write failing test for the multi-color extraction**

Create `Backend/dollup-medusa/src/lib/__tests__/shein-extract.spec.ts`:

```typescript
import { readFileSync } from "fs"
import { join } from "path"
import { extractFromShein } from "../shein-extract"

const fixture = (name: string) =>
  readFileSync(join(__dirname, "fixtures/shein", name), "utf8")

describe("extractFromShein", () => {
  it("extracts title, price, sizes, and per-color images from a multi-color dress", () => {
    const html = fixture("dress-multicolor.html")

    const result = extractFromShein(html)

    expect(result).not.toBeNull()
    expect(result!.title.length).toBeGreaterThan(0)
    expect(result!.sheinPriceUsd).toBeGreaterThan(0)
    expect(result!.sizes.length).toBeGreaterThanOrEqual(2)
    expect(result!.colors.length).toBeGreaterThanOrEqual(2)
    for (const c of result!.colors) {
      expect(c.name.length).toBeGreaterThan(0)
      expect(c.images.length).toBeGreaterThanOrEqual(1)
      for (const url of c.images) {
        expect(url).toMatch(/^https:\/\/img\.ltwebstatic\.com\//)
      }
    }
    expect(result!.stockAvailable).toBe(true)
  })

  it("extracts a single-color product without throwing", () => {
    const html = fixture("single-color.html")
    const result = extractFromShein(html)
    expect(result).not.toBeNull()
    expect(result!.colors.length).toBe(1)
    expect(result!.stockAvailable).toBe(true)
  })

  it("reports stockAvailable=false for a sold-out product", () => {
    const html = fixture("sold-out.html")
    const result = extractFromShein(html)
    expect(result).not.toBeNull()
    expect(result!.stockAvailable).toBe(false)
  })

  it("returns null when neither gbProductSsrData nor JSON-LD are present", () => {
    const result = extractFromShein("<html><body>Not SHEIN</body></html>")
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd Backend/dollup-medusa
yarn test:unit src/lib/__tests__/shein-extract.spec.ts
```

Expected: FAIL (module `../shein-extract` not found).

- [ ] **Step 4: Implement the parser**

Create `Backend/dollup-medusa/src/lib/shein-extract.ts`:

```typescript
/**
 * Pure parser for SHEIN product pages. Used by:
 *   1. /admin/preorder/bookmarklet (validates the data already-extracted in the
 *      browser by the bookmarklet JS — extractFromObject path)
 *   2. The daily availability-check cron (parses HTML fetched server-side —
 *      extractFromShein path)
 *
 * Strategy: prefer window.gbProductSsrData (SHEIN's hydration state, richest
 * source). Fallback to JSON-LD <script type="application/ld+json"> blocks
 * (less detail but more stable across SHEIN refactors).
 *
 * No DOM. No external deps. Pure string-in / object-out so it's trivially
 * unit-testable and works in both Node and the daily cron.
 */

export type ExtractedColor = {
  name: string
  images: string[]
}

export type ExtractedShein = {
  title: string
  sheinPriceUsd: number
  sizes: string[]
  colors: ExtractedColor[]
  stockAvailable: boolean
}

const SHEIN_CDN_REGEX = /^https:\/\/img\.ltwebstatic\.com\//

const SSR_DATA_REGEX = /window\.gbProductSsrData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/

const JSON_LD_REGEX = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g

/**
 * Main entry: HTML string → normalized shape (or null if nothing parseable).
 */
export function extractFromShein(html: string): ExtractedShein | null {
  const ssr = extractSsrObject(html)
  if (ssr) {
    const fromSsr = extractFromObject(ssr)
    if (fromSsr) return fromSsr
  }
  return extractFromJsonLd(html)
}

/**
 * Bookmarklet-friendly entry: already-parsed gbProductSsrData object → shape.
 * Exported so the bookmarklet route can call it on the JSON body directly
 * (without re-stringifying first).
 */
export function extractFromObject(ssr: unknown): ExtractedShein | null {
  if (!ssr || typeof ssr !== "object") return null
  const root = ssr as Record<string, any>

  const intro = root.productIntroData ?? root.product_intro_data
  if (!intro || typeof intro !== "object") return null

  const detail = intro.detail ?? {}
  const title: string =
    typeof detail.goods_name === "string" ? detail.goods_name.trim() : ""
  if (!title) return null

  const priceUsd = parsePriceUsd(detail)
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null

  const sizes = extractSizes(intro)
  const colors = extractColors(intro)
  if (colors.length === 0) return null

  const stockAvailable = extractStockAvailable(intro)

  return { title, sheinPriceUsd: priceUsd, sizes, colors, stockAvailable }
}

function extractSsrObject(html: string): unknown | null {
  const match = html.match(SSR_DATA_REGEX)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

function parsePriceUsd(detail: Record<string, any>): number {
  // SHEIN typically exposes `salePrice.amount` (string, USD) when locale=US.
  const candidates: any[] = [
    detail.salePrice?.amount,
    detail.sale_price?.amount,
    detail.retailPrice?.amount,
    detail.retail_price?.amount,
  ]
  for (const c of candidates) {
    const n = typeof c === "string" ? parseFloat(c) : typeof c === "number" ? c : NaN
    if (Number.isFinite(n) && n > 0) return n
  }
  return NaN
}

function extractSizes(intro: Record<string, any>): string[] {
  // sku_relation_info is the per-variant list; each variant has attr_value_name
  // for size when size is one of the attributes.
  const skuRel: any[] = intro.detail?.sku_relation_info ?? []
  const seen = new Set<string>()
  for (const sku of skuRel) {
    const attrs: any[] = sku?.attr_value_list ?? []
    for (const a of attrs) {
      if (a?.attr_name === "Size" && typeof a.attr_value_name === "string") {
        seen.add(a.attr_value_name)
      }
    }
  }
  return Array.from(seen)
}

function extractColors(intro: Record<string, any>): ExtractedColor[] {
  // SHEIN's color list lives on intro.relation_color (each entry is a sibling
  // product representing one color). Each has its own goods_thumb + a small
  // image list. We fall back to the main product's image list if relation_color
  // is missing (single-color products).
  const rel: any[] = intro.relation_color ?? []
  const colors: ExtractedColor[] = []

  if (Array.isArray(rel) && rel.length > 0) {
    for (const entry of rel) {
      const name =
        typeof entry?.color_name === "string" && entry.color_name.trim()
          ? entry.color_name.trim()
          : typeof entry?.goods_color_name === "string"
            ? entry.goods_color_name.trim()
            : ""
      const images = collectImageUrls(entry)
      if (name && images.length > 0) colors.push({ name, images })
    }
  }

  if (colors.length === 0) {
    // Single-color product — pull from the main intro images.
    const name =
      typeof intro.detail?.color_name === "string"
        ? intro.detail.color_name.trim()
        : "Default"
    const images = collectImageUrls(intro.detail ?? {})
    if (images.length > 0) colors.push({ name, images })
  }

  return colors
}

function collectImageUrls(entry: Record<string, any>): string[] {
  const out: string[] = []
  const push = (url: unknown) => {
    if (typeof url !== "string") return
    const trimmed = url.trim()
    if (!SHEIN_CDN_REGEX.test(trimmed)) return
    if (!out.includes(trimmed)) out.push(trimmed)
  }
  push(entry.goods_thumb)
  push(entry.goods_img)
  const detailImages: any[] = entry.detail_image ?? entry.detailImage ?? []
  for (const img of detailImages) {
    push(img?.origin_image ?? img?.url ?? img)
  }
  const galleryImages: any[] = entry.image_list ?? entry.imageList ?? []
  for (const img of galleryImages) {
    push(img?.origin_image ?? img?.url ?? img)
  }
  return out
}

function extractStockAvailable(intro: Record<string, any>): boolean {
  if (intro?.detail?.is_sold_out === 1 || intro?.detail?.is_sold_out === "1") {
    return false
  }
  const skuRel: any[] = intro.detail?.sku_relation_info ?? []
  if (skuRel.length === 0) {
    // No per-sku breakdown — fall back to product-level stock field if present.
    const stock = intro?.detail?.stock
    if (typeof stock === "number") return stock > 0
    return true
  }
  return skuRel.some(
    (sku) => typeof sku?.stock === "number" && sku.stock > 0,
  )
}

function extractFromJsonLd(html: string): ExtractedShein | null {
  const matches = [...html.matchAll(JSON_LD_REGEX)]
  for (const m of matches) {
    try {
      const data = JSON.parse(m[1])
      const product = pickJsonLdProduct(data)
      if (!product) continue
      const title: string =
        typeof product.name === "string" ? product.name.trim() : ""
      const offers = Array.isArray(product.offers)
        ? product.offers[0]
        : product.offers
      const priceUsd =
        typeof offers?.price === "string"
          ? parseFloat(offers.price)
          : typeof offers?.price === "number"
            ? offers.price
            : NaN
      if (!title || !Number.isFinite(priceUsd) || priceUsd <= 0) continue
      const imageRaw = product.image
      const images: string[] = Array.isArray(imageRaw)
        ? imageRaw.filter(
            (u: unknown): u is string =>
              typeof u === "string" && SHEIN_CDN_REGEX.test(u),
          )
        : typeof imageRaw === "string" && SHEIN_CDN_REGEX.test(imageRaw)
          ? [imageRaw]
          : []
      if (images.length === 0) continue
      const availability =
        typeof offers?.availability === "string" ? offers.availability : ""
      const stockAvailable = !/OutOfStock/i.test(availability)
      return {
        title,
        sheinPriceUsd: priceUsd,
        sizes: [],
        colors: [{ name: "Default", images }],
        stockAvailable,
      }
    } catch {
      // try next block
    }
  }
  return null
}

function pickJsonLdProduct(data: unknown): Record<string, any> | null {
  if (!data) return null
  if (Array.isArray(data)) {
    for (const item of data) {
      const p = pickJsonLdProduct(item)
      if (p) return p
    }
    return null
  }
  if (typeof data === "object") {
    const obj = data as Record<string, any>
    if (obj["@type"] === "Product") return obj
    if (Array.isArray(obj["@graph"])) return pickJsonLdProduct(obj["@graph"])
  }
  return null
}
```

- [ ] **Step 5: Run tests until they pass**

```bash
cd Backend/dollup-medusa
yarn test:unit src/lib/__tests__/shein-extract.spec.ts
```

Expected: PASS (all 4 cases). If a case fails because a real SHEIN fixture has different field names than the code expects, EDIT the parser to match the actual fixture data — the fixture is the ground truth. Do NOT edit the fixture to match the code.

- [ ] **Step 6: Commit**

```bash
cd Backend/dollup-medusa
git add src/lib/shein-extract.ts src/lib/__tests__/shein-extract.spec.ts src/lib/__tests__/fixtures/shein/
git commit -m "feat(preorder): SHEIN parser with gbProductSsrData + JSON-LD fallback"
```

---

## Task 2: Build the shared preorder-product creator helper

**Files:**
- Create: `Backend/dollup-medusa/src/api/admin/preorder/lib/create-preorder-product.ts`
- Create: `Backend/dollup-medusa/src/api/admin/preorder/lib/__tests__/create-preorder-product.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `Backend/dollup-medusa/src/api/admin/preorder/lib/__tests__/create-preorder-product.spec.ts`:

```typescript
import { normalizeColorsInput } from "../create-preorder-product"

describe("normalizeColorsInput", () => {
  it("accepts new multi-image shape unchanged", () => {
    const input = {
      colors: [
        { name: "Beige", images: ["https://img.ltwebstatic.com/a.jpg"] },
      ],
    }
    expect(normalizeColorsInput(input as any)).toEqual(input.colors)
  })

  it("upgrades legacy {colors:string[], imageUrl} to new shape", () => {
    const input = {
      colors: ["Beige", "Black"] as any,
      imageUrl: "https://img.ltwebstatic.com/main.jpg",
    }
    expect(normalizeColorsInput(input)).toEqual([
      { name: "Beige", images: ["https://img.ltwebstatic.com/main.jpg"] },
      { name: "Black", images: ["https://img.ltwebstatic.com/main.jpg"] },
    ])
  })

  it("defaults to a single Default color when nothing is provided", () => {
    const input = { imageUrl: "https://img.ltwebstatic.com/x.jpg" }
    expect(normalizeColorsInput(input as any)).toEqual([
      { name: "Default", images: ["https://img.ltwebstatic.com/x.jpg"] },
    ])
  })

  it("throws when colors[i].images is empty", () => {
    expect(() =>
      normalizeColorsInput({
        colors: [{ name: "X", images: [] }],
      } as any),
    ).toThrow(/at least one image/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd Backend/dollup-medusa
yarn test:unit src/api/admin/preorder/lib/__tests__/create-preorder-product.spec.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement the helper**

Create `Backend/dollup-medusa/src/api/admin/preorder/lib/create-preorder-product.ts`:

```typescript
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"

import { PREORDER_MODULE } from "../../../../modules/preorder"
import type PreorderModuleService from "../../../../modules/preorder/service"

const PREORDER_SHIPPING_PROFILE_NAME = "Pre-Order Shipping"

export type CreatePreorderProductInput = {
  title: string
  sheinUrl: string
  sheinPriceUsd: number
  description?: string
  sizes?: string[]
  // New shape: per-color images.
  colors?: Array<{ name: string; images: string[] }>
  // Legacy shape (still accepted from the existing admin form):
  imageUrl?: string
}

export type CreatePreorderProductResult = {
  product: { id: string; handle: string }
  preview: {
    sheinPriceMur: number
    finalPriceMur: number
    fxRateUsed: number
  }
}

/**
 * Normalizes whichever shape the caller sent into the canonical
 * [{name, images}] list. Exported so it can be unit-tested in isolation
 * without spinning up a container.
 */
export function normalizeColorsInput(
  input: Pick<CreatePreorderProductInput, "colors" | "imageUrl">,
): Array<{ name: string; images: string[] }> {
  // New shape — already canonical, just validate.
  if (Array.isArray(input.colors) && input.colors.length > 0 && typeof input.colors[0] === "object") {
    const colors = input.colors as Array<{ name: string; images: string[] }>
    for (const c of colors) {
      if (!c.name || typeof c.name !== "string") {
        throw new Error("colors[].name must be a non-empty string")
      }
      if (!Array.isArray(c.images) || c.images.length === 0) {
        throw new Error(`colors[${c.name}] must have at least one image`)
      }
    }
    return colors
  }

  // Legacy shape — string[] of color names + single imageUrl.
  if (Array.isArray(input.colors) && input.colors.length > 0) {
    const names = input.colors as unknown as string[]
    if (!input.imageUrl || typeof input.imageUrl !== "string") {
      throw new Error("legacy colors:string[] requires imageUrl")
    }
    return names.map((name) => ({ name, images: [input.imageUrl!] }))
  }

  // No colors at all — use a single Default color from imageUrl.
  if (input.imageUrl && typeof input.imageUrl === "string") {
    return [{ name: "Default", images: [input.imageUrl] }]
  }

  throw new Error("must provide either colors[{name,images}] or imageUrl")
}

/**
 * Runs the full create-and-link flow for a pre-order product. Both the regular
 * admin POST and the bookmarklet POST call this — keep all the workflow
 * idiosyncrasies (silent sales_channels no-op fix; shipping profile lookup) in
 * one place.
 */
export async function createPreorderProduct(
  container: MedusaContainer,
  input: CreatePreorderProductInput,
  preorderSalesChannelId: string,
): Promise<CreatePreorderProductResult> {
  const colors = normalizeColorsInput(input)
  const sizes = input.sizes?.length ? input.sizes : ["One Size"]

  const svc = container.resolve<PreorderModuleService>(PREORDER_MODULE)
  const preview = await svc.previewPrice({ sheinPriceUsd: input.sheinPriceUsd })
  const settings = await svc.getSettings()

  const fulfillmentService = container.resolve(Modules.FULFILLMENT)
  const [preorderProfile] = await fulfillmentService.listShippingProfiles({
    name: PREORDER_SHIPPING_PROFILE_NAME,
  })
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any
  if (!preorderProfile) {
    logger.warn?.(
      `[create-preorder-product] Pre-Order shipping profile not found. Product will fall back to default profile.`,
    )
  }

  // Each variant gets its own per-color image_urls metadata so the storefront
  // gallery can swap on color change.
  const variants = colors.flatMap((color) =>
    sizes.map((size) => ({
      title: `${color.name} / ${size}`,
      sku: undefined,
      options: { Color: color.name, Size: size },
      prices: [{ currency_code: "mur", amount: preview.finalPriceMur * 100 }],
      manage_inventory: false,
      metadata: { image_urls: color.images },
    })),
  )

  const handle =
    input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") +
    "-preorder-" +
    Date.now().toString(36)

  const productImages = colors.flatMap((c) => c.images.map((url) => ({ url })))
  const thumbnail = colors[0].images[0]

  const result = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: input.title,
          handle,
          description: input.description ?? "",
          status: "published",
          images: productImages,
          thumbnail,
          options: [
            { title: "Color", values: colors.map((c) => c.name) },
            { title: "Size", values: sizes },
          ],
          variants,
          metadata: {
            is_preorder: true,
            shein_url: input.sheinUrl,
            shein_price_usd: input.sheinPriceUsd,
            preorder_fx_rate: preview.fxRateUsed,
            preorder_eta_min_days: settings.eta_min_days,
            preorder_eta_max_days: settings.eta_max_days,
            preorder_priced_at: new Date().toISOString(),
          },
          sales_channels: [{ id: preorderSalesChannelId }],
          ...(preorderProfile
            ? { shipping_profile_id: preorderProfile.id }
            : {}),
        },
      ],
    },
  })

  const created = (result.result as Array<{ id: string; handle: string }>)[0]

  // createProductsWorkflow's sales_channels input silently no-ops in Medusa
  // 2.13.1 — explicit remoteLink.create guarantees the link. See the
  // 2026-05-27 fix in memory.
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
  try {
    await remoteLink.create({
      [Modules.PRODUCT]: { product_id: created.id },
      [Modules.SALES_CHANNEL]: {
        sales_channel_id: preorderSalesChannelId,
      },
    })
  } catch (err: any) {
    if (
      err?.message?.includes("already exists") ||
      err?.message?.includes("duplicate") ||
      err?.code === "23505"
    ) {
      // already linked — desired state
    } else {
      logger.warn?.(
        `[create-preorder-product] Failed to link product ${created.id} to Pre-Order channel: ${err?.message ?? err}`,
      )
    }
  }

  return { product: { id: created.id, handle: created.handle }, preview }
}
```

- [ ] **Step 4: Run tests until they pass**

```bash
cd Backend/dollup-medusa
yarn test:unit src/api/admin/preorder/lib/__tests__/create-preorder-product.spec.ts
```

Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
cd Backend/dollup-medusa
git add src/api/admin/preorder/lib/
git commit -m "feat(preorder): shared createPreorderProduct helper with per-color images"
```

---

## Task 3: Refactor existing POST to use the shared helper

**Files:**
- Modify: `Backend/dollup-medusa/src/api/admin/preorder/products/route.ts`

- [ ] **Step 1: Read the current POST handler**

Open `Backend/dollup-medusa/src/api/admin/preorder/products/route.ts`. The POST currently has ~100 lines of body validation + variant building + workflow call + remote link. We're replacing the second half (everything after body validation) with one call to `createPreorderProduct`.

- [ ] **Step 2: Replace POST body**

Replace the entire `POST` handler (keep the imports, the file-level const, and the GET handler unchanged):

```typescript
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const PREORDER_SALES_CHANNEL_ID = process.env.PREORDER_SALES_CHANNEL_ID
  if (!PREORDER_SALES_CHANNEL_ID) {
    res.status(500).json({
      message:
        "PREORDER_SALES_CHANNEL_ID env var is not set on the backend. Cannot create pre-order products without a sales channel binding.",
    })
    return
  }

  const body = (req.body ?? {}) as Partial<{
    title: string
    sheinUrl: string
    sheinPriceUsd: number
    description?: string
    sizes?: string[]
    // Legacy shape:
    imageUrl?: string
    colors?: string[] | Array<{ name: string; images: string[] }>
  }>

  const errors: string[] = []
  if (!body.title || typeof body.title !== "string") errors.push("title required")
  if (!body.sheinUrl || typeof body.sheinUrl !== "string") errors.push("sheinUrl required")
  if (typeof body.sheinPriceUsd !== "number" || !(body.sheinPriceUsd > 0)) {
    errors.push("sheinPriceUsd must be a positive number")
  }
  // imageUrl is only required for the legacy shape. New shape carries images
  // in colors[i].images and the helper will reject empty arrays.
  const hasNewColorsShape =
    Array.isArray(body.colors) &&
    body.colors.length > 0 &&
    typeof body.colors[0] === "object"
  if (!hasNewColorsShape && (!body.imageUrl || typeof body.imageUrl !== "string")) {
    errors.push("imageUrl required when colors is a string[] or not provided")
  }

  if (errors.length > 0) {
    res.status(400).json({ message: errors.join("; ") })
    return
  }

  if (!/(^https?:\/\/)(m\.)?shein\.com\//i.test(body.sheinUrl!)) {
    res.status(400).json({ message: "sheinUrl must be a https://shein.com or https://m.shein.com URL" })
    return
  }

  try {
    const result = await createPreorderProduct(
      req.scope,
      {
        title: body.title!,
        sheinUrl: body.sheinUrl!,
        sheinPriceUsd: body.sheinPriceUsd!,
        description: body.description,
        sizes: body.sizes,
        colors: body.colors as any,
        imageUrl: body.imageUrl,
      },
      PREORDER_SALES_CHANNEL_ID,
    )
    res.json(result)
  } catch (err: any) {
    res.status(400).json({ message: err?.message ?? "create failed" })
  }
}
```

Add the import at the top of the file:

```typescript
import { createPreorderProduct } from "./lib/create-preorder-product"
```

You should now delete from the file: the inline `colors`/`sizes` defaulting, the `variants.flatMap(...)`, the `handle` build, the `createProductsWorkflow(req.scope).run(...)` call, the `remoteLink.create` block. All of that lives in the helper now. The shipping-profile lookup also moves into the helper — delete the inline lookup. The `PREORDER_SHIPPING_PROFILE_NAME` constant can stay (still used by other code? grep first) — if nothing else uses it, delete it.

- [ ] **Step 3: Typecheck**

```bash
cd Backend/dollup-medusa
yarn build
```

Expected: builds cleanly. If you get a "PREORDER_SHIPPING_PROFILE_NAME unused" error, delete that constant.

- [ ] **Step 4: Run existing tests**

```bash
cd Backend/dollup-medusa
yarn test:unit
```

Expected: existing passing tests still pass, plus the 2 new test files from Task 1+2 pass. Some pre-existing test files (chat, stories) have unrelated TypeScript errors — those don't matter for this task.

- [ ] **Step 5: Commit**

```bash
cd Backend/dollup-medusa
git add src/api/admin/preorder/products/route.ts
git commit -m "refactor(preorder): POST uses shared createPreorderProduct helper"
```

---

## Task 4: Extend storefront `PreorderProduct` type for per-color images

**Files:**
- Modify: `DUB-front/src/lib/preorder.ts`

- [ ] **Step 1: Update the type definition**

Open `DUB-front/src/lib/preorder.ts`. Find:

```typescript
export type PreorderProduct = {
  id: string;
  handle: string;
  title: string;
  thumbnail: string | null;
  variants: Array<{
    id: string;
    calculated_price?: { calculated_amount: number };
  }>;
  metadata?: Record<string, unknown> | null;
};
```

Replace with:

```typescript
export type PreorderVariant = {
  id: string;
  title?: string;
  calculated_price?: { calculated_amount: number };
  options?: Array<{
    value: string;
    option?: { title?: string };
    option_id?: string;
  }>;
  metadata?: { image_urls?: string[] } | null;
};

export type PreorderProduct = {
  id: string;
  handle: string;
  title: string;
  description?: string;
  thumbnail: string | null;
  images?: Array<{ url: string }>;
  options?: Array<{
    id: string;
    title: string;
    values: Array<{ value: string }>;
  }>;
  variants: PreorderVariant[];
  metadata?: Record<string, unknown> | null;
};
```

- [ ] **Step 2: Typecheck**

```bash
cd DUB-front
npx tsc --noEmit
```

Expected: PASS. The PDP and listing components already use the matching shape.

- [ ] **Step 3: Commit**

```bash
cd DUB-front
git add src/lib/preorder.ts
git commit -m "feat(preorder): extend PreorderProduct type with per-color image metadata"
```

---

## Task 5: Build PreorderGallery component (storefront)

**Files:**
- Create: `DUB-front/src/components/preorder/PreorderGallery.tsx`

- [ ] **Step 1: Write the component**

Create `DUB-front/src/components/preorder/PreorderGallery.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { PDP_COLOR_CHANGE_EVENT } from "@/components/product/ProductGallery";

type Props = {
  colorImageMap: Record<string, string[]>;
  initialColor: string;
  productTitle: string;
};

export function PreorderGallery({
  colorImageMap,
  initialColor,
  productTitle,
}: Props) {
  const [activeColor, setActiveColor] = useState(initialColor);
  const images = colorImageMap[activeColor] ?? [];
  const [mainIdx, setMainIdx] = useState(0);

  useEffect(() => {
    setMainIdx(0);
  }, [activeColor]);

  useEffect(() => {
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ value: string }>).detail;
      if (!detail?.value) return;
      if (colorImageMap[detail.value]) {
        setActiveColor(detail.value);
      }
    }
    window.addEventListener(PDP_COLOR_CHANGE_EVENT, handler);
    return () => window.removeEventListener(PDP_COLOR_CHANGE_EVENT, handler);
  }, [colorImageMap]);

  if (images.length === 0) {
    return (
      <div className="aspect-[3/4] w-full rounded-lg border border-sage-100 bg-blush-50" />
    );
  }

  return (
    <div className="space-y-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={images[mainIdx]}
        alt={`${productTitle} — ${activeColor}`}
        className="w-full rounded-lg border border-sage-100 bg-blush-50"
      />
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {images.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setMainIdx(i)}
              className={
                "h-16 w-16 flex-shrink-0 overflow-hidden rounded border transition " +
                (i === mainIdx
                  ? "border-sage-700"
                  : "border-sage-200 hover:border-sage-300")
              }
              aria-label={`Show image ${i + 1} of ${images.length}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd DUB-front
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd DUB-front
git add src/components/preorder/PreorderGallery.tsx
git commit -m "feat(preorder): PreorderGallery client component listens to color-change event"
```

---

## Task 6: Build PreorderColorSwatches component (storefront)

**Files:**
- Create: `DUB-front/src/components/preorder/PreorderColorSwatches.tsx`

- [ ] **Step 1: Write the component**

Create `DUB-front/src/components/preorder/PreorderColorSwatches.tsx`:

```tsx
"use client";

import { useState } from "react";
import { PDP_COLOR_CHANGE_EVENT } from "@/components/product/ProductGallery";

type Props = {
  colors: string[];
  initialColor: string;
  onChange?: (color: string) => void;
};

export function PreorderColorSwatches({ colors, initialColor, onChange }: Props) {
  const [active, setActive] = useState(initialColor);

  const pick = (c: string) => {
    setActive(c);
    onChange?.(c);
    window.dispatchEvent(
      new CustomEvent(PDP_COLOR_CHANGE_EVENT, { detail: { value: c } }),
    );
  };

  if (colors.length <= 1) return null;

  return (
    <div className="space-y-2">
      <p className="text-[12px] font-medium text-ink">Color · <span className="text-ink-muted">{active}</span></p>
      <div className="flex flex-wrap gap-2">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => pick(c)}
            className={
              "rounded border px-3 py-1 text-[13px] transition " +
              (c === active
                ? "border-sage-700 bg-sage-700 text-cream"
                : "border-sage-200 text-ink hover:border-sage-400")
            }
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd DUB-front
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd DUB-front
git add src/components/preorder/PreorderColorSwatches.tsx
git commit -m "feat(preorder): PreorderColorSwatches fires PDP color-change event"
```

---

## Task 7: Wire the PDP to use gallery + swatches + per-color metadata

**Files:**
- Modify: `DUB-front/src/app/(preorder)/preorder/products/[handle]/page.tsx`

- [ ] **Step 1: Replace the PDP**

Open `DUB-front/src/app/(preorder)/preorder/products/[handle]/page.tsx`. Replace the entire file with:

```tsx
import { notFound } from "next/navigation";
import { computeDepositSplit, getPreorderProduct, type PreorderVariant } from "@/lib/preorder";
import { PreorderBadge } from "@/components/preorder/PreorderBadge";
import { PreorderEtaBadge } from "@/components/preorder/PreorderEtaBadge";
import { AddToPreorderCart } from "@/components/preorder/AddToPreorderCart";
import { PreorderGallery } from "@/components/preorder/PreorderGallery";
import { PreorderColorSwatches } from "@/components/preorder/PreorderColorSwatches";

export const revalidate = 60;

function colorOf(variant: PreorderVariant): string | null {
  const opt = variant.options?.find(
    (o) => o.option?.title === "Color" || o.option?.title === "color",
  );
  return opt?.value ?? null;
}

export default async function PreorderPDP({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const product = await getPreorderProduct(handle);
  if (!product) notFound();

  // Group variants by color so we can build the per-color image map. Each
  // color's first variant's metadata.image_urls is the source of truth (all
  // variants of the same color share the same image_urls).
  const colorImageMap: Record<string, string[]> = {};
  const colorOrder: string[] = [];
  for (const v of product.variants) {
    const c = colorOf(v) ?? "Default";
    if (!colorImageMap[c]) {
      colorOrder.push(c);
      const fromMeta = v.metadata?.image_urls;
      colorImageMap[c] =
        Array.isArray(fromMeta) && fromMeta.length > 0
          ? fromMeta
          : product.thumbnail
            ? [product.thumbnail]
            : [];
    }
  }
  const initialColor = colorOrder[0] ?? "Default";

  const price = product.variants[0]?.calculated_price?.calculated_amount ?? null;
  const depositPercent = 75;
  const priceMur = price !== null ? Math.round(price / 100) : null;
  const split =
    priceMur !== null
      ? computeDepositSplit(priceMur, depositPercent)
      : null;
  const depositAmount = split ? split.depositMur * 100 : null;
  const balanceAmount = split ? split.balanceMur * 100 : null;

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-10 lg:grid-cols-2">
      <PreorderGallery
        colorImageMap={colorImageMap}
        initialColor={initialColor}
        productTitle={product.title}
      />

      <div>
        <PreorderBadge />
        <h1 className="mt-3 font-display text-3xl leading-tight text-ink">
          {product.title}
        </h1>

        <div className="mt-3">
          <PreorderEtaBadge />
        </div>

        {price !== null && (
          <div className="mt-5 flex items-baseline gap-3">
            <p className="font-display text-3xl text-ink">
              Rs {(price / 100).toFixed(0)}
            </p>
            <span className="text-[12px] text-ink-muted">all-in price</span>
          </div>
        )}

        {depositAmount !== null && balanceAmount !== null && (
          <div className="mt-5 grid grid-cols-2 overflow-hidden rounded-lg border border-sage-200">
            <div className="border-r border-sage-200 bg-sage-50 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sage-700">
                Deposit now
              </p>
              <p className="mt-1 font-display text-xl text-ink">
                Rs {(depositAmount / 100).toFixed(0)}
              </p>
              <p className="mt-1 text-[11px] text-ink-muted">via Juice transfer</p>
            </div>
            <div className="bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
                Balance on arrival
              </p>
              <p className="mt-1 font-display text-xl text-ink">
                Rs {(balanceAmount / 100).toFixed(0)}
              </p>
              <p className="mt-1 text-[11px] text-ink-muted">cash, Juice or card</p>
            </div>
          </div>
        )}

        {colorOrder.length > 1 && (
          <div className="mt-6">
            <PreorderColorSwatches colors={colorOrder} initialColor={initialColor} />
          </div>
        )}

        <div className="mt-6 rounded-lg border border-sage-200 bg-sage-50 p-5 text-[13px] text-ink-soft">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sage-700">
            How pre-order works
          </p>
          <ol className="mt-3 space-y-2">
            <li className="flex gap-3">
              <span className="font-display text-sage-300">01</span>
              <span>{depositPercent}% deposit via Juice reserves your piece.</span>
            </li>
            <li className="flex gap-3">
              <span className="font-display text-sage-300">02</span>
              <span>We order from SHEIN within 7 days.</span>
            </li>
            <li className="flex gap-3">
              <span className="font-display text-sage-300">03</span>
              <span>Ships ~15–20 days from order.</span>
            </li>
            <li className="flex gap-3">
              <span className="font-display text-sage-300">04</span>
              <span>Pay balance when ready for delivery or collection.</span>
            </li>
          </ol>
          <p className="mt-4 rounded border border-coral-300 bg-white px-3 py-2 text-[12px] font-semibold text-coral-700">
            All pre-order sales are final — no cancellations or refunds once deposit is paid.
          </p>
        </div>

        <div className="mt-6">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <AddToPreorderCart product={product as any} />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd DUB-front
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd DUB-front
git add src/app/(preorder)/preorder/products/[handle]/page.tsx
git commit -m "feat(preorder): PDP gallery follows selected color"
```

---

## Task 8: Phase 1 smoke test on staging

**Files:** none — manual test.

- [ ] **Step 1: Push backend and frontend**

```bash
cd Backend/dollup-medusa && git push origin master
cd ../../DUB-front && git push origin master
```

- [ ] **Step 2: Wait for Coolify to redeploy both**

Watch the Coolify dashboard. ~3-4 min total. Backend usually finishes first.

- [ ] **Step 3: Backfill existing 2 products with per-color images via the admin form**

The 2 existing preorder products (Strapless, Floral Dress) were created BEFORE per-color images. They have one image per color (the SHEIN one). They'll keep displaying that one image — gallery component will just show one. That's the expected backward-compat behavior. Don't backfill anything manually.

- [ ] **Step 4: Create a new test product through the admin form**

In dollup-admin → /preorder → New pre-order. Use any SHEIN product. The current form only collects one imageUrl, so the new product will also have one image per color. Verify on `preorder.dollupboutique.com`:

1. Product appears on the listing.
2. PDP loads cleanly (no 500).
3. Color buttons appear ONLY if the product has 2+ colors. Single-color products show no swatch row.
4. Clicking a color swatch swaps the main image (only really visible once Phase 2 ships the bookmarklet which captures multiple images per color).

- [ ] **Step 5: Mark Phase 1 done**

If smoke passes: Phase 1 is shipped. Continue to Phase 2. If anything fails: stop, debug, do not move to Phase 2.

---

# Phase 2 — Token + bookmarklet route + admin settings page + bookmarklet JS

## Task 9: Create the preorder_token model + migration

**Files:**
- Create: `Backend/dollup-medusa/src/modules/preorder/models/preorder-token.ts`
- Create: `Backend/dollup-medusa/src/modules/preorder/migrations/Migration20260528000000.ts`

- [ ] **Step 1: Create the model**

Create `Backend/dollup-medusa/src/modules/preorder/models/preorder-token.ts`:

```typescript
import { model } from "@medusajs/framework/utils"

/**
 * Personal access token for the SHEIN bookmarklet. Single active row at a
 * time — generating a new token revokes any prior unrevoked rows in the
 * service layer.
 *
 * Stored as sha-256 hex of the plaintext. The plaintext is shown to the user
 * exactly once on generation and never returned again from any endpoint.
 */
const PreorderToken = model.define("PreorderToken", {
  id: model.id({ prefix: "pretok" }).primaryKey(),
  token_hash: model.text(),
  expires_at: model.dateTime().nullable(),
  last_used_at: model.dateTime().nullable(),
  revoked_at: model.dateTime().nullable(),
})

export default PreorderToken
```

- [ ] **Step 2: Create the migration**

Create `Backend/dollup-medusa/src/modules/preorder/migrations/Migration20260528000000.ts`:

```typescript
import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260528000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "preorder_token" (' +
        '"id" text not null, ' +
        '"token_hash" text not null, ' +
        '"expires_at" timestamptz null, ' +
        '"last_used_at" timestamptz null, ' +
        '"revoked_at" timestamptz null, ' +
        '"created_at" timestamptz not null default now(), ' +
        '"updated_at" timestamptz not null default now(), ' +
        '"deleted_at" timestamptz null, ' +
        'constraint "preorder_token_pkey" primary key ("id"));',
    )
    this.addSql(
      'create unique index if not exists "preorder_token_hash_unique" on "preorder_token" ("token_hash") where "deleted_at" is null;',
    )
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "preorder_token" cascade;')
  }
}
```

- [ ] **Step 3: Register the model on the module**

Open `Backend/dollup-medusa/src/modules/preorder/service.ts`. Find:

```typescript
class PreorderModuleService extends MedusaService({
  PreorderSettings,
}) {
```

Replace with:

```typescript
import PreorderToken from "./models/preorder-token"

class PreorderModuleService extends MedusaService({
  PreorderSettings,
  PreorderToken,
}) {
```

(Add the import at the top of the file with the other imports.)

- [ ] **Step 4: Build the backend**

```bash
cd Backend/dollup-medusa
yarn build
```

Expected: builds cleanly.

- [ ] **Step 5: Commit**

```bash
cd Backend/dollup-medusa
git add src/modules/preorder/models/preorder-token.ts \
        src/modules/preorder/migrations/Migration20260528000000.ts \
        src/modules/preorder/service.ts
git commit -m "feat(preorder): add PreorderToken model + migration"
```

---

## Task 10: Add token service methods (generate, verify, revoke)

**Files:**
- Modify: `Backend/dollup-medusa/src/modules/preorder/service.ts`
- Create: `Backend/dollup-medusa/src/modules/preorder/__tests__/token-service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `Backend/dollup-medusa/src/modules/preorder/__tests__/token-service.spec.ts`:

```typescript
import { hashTokenForTest } from "../service"

describe("preorder token hashing", () => {
  it("hashes the same plaintext to the same digest", () => {
    expect(hashTokenForTest("abc123")).toEqual(hashTokenForTest("abc123"))
  })

  it("hashes different plaintexts to different digests", () => {
    expect(hashTokenForTest("abc123")).not.toEqual(hashTokenForTest("abc124"))
  })

  it("produces a 64-char hex digest", () => {
    const h = hashTokenForTest("anything")
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

(The service-level integration test with a real DB session is heavyweight and lives later in `__tests__/integration/`. For the unit-level commit we just verify the hashing primitive — it's the trickiest part.)

- [ ] **Step 2: Run test to verify it fails**

```bash
cd Backend/dollup-medusa
yarn test:unit src/modules/preorder/__tests__/token-service.spec.ts
```

Expected: FAIL (hashTokenForTest not exported).

- [ ] **Step 3: Add the service methods**

Open `Backend/dollup-medusa/src/modules/preorder/service.ts`. Add these imports at the top (next to existing imports):

```typescript
import { createHash, randomBytes } from "crypto"
```

Inside the `PreorderModuleService` class (after `previewPrice`), add:

```typescript
async generateBookmarkletToken(
  options: { expiresInDays?: number } = {},
): Promise<{ token: string; expiresAt: Date | null }> {
  const expiresInDays = options.expiresInDays ?? 90
  const expiresAt =
    expiresInDays > 0
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null

  // Revoke previous active tokens — single-active-token policy.
  const service = this as unknown as {
    listPreorderTokens: (
      filters: Record<string, unknown>,
    ) => Promise<Array<{ id: string }>>
    updatePreorderTokens: (
      input: Record<string, unknown> & { id: string },
    ) => Promise<unknown>
    createPreorderTokens: (
      input: Record<string, unknown>,
    ) => Promise<{ id: string }>
  }
  const previous = await service.listPreorderTokens({
    revoked_at: null,
  })
  for (const row of previous) {
    await service.updatePreorderTokens({
      id: row.id,
      revoked_at: new Date(),
    })
  }

  const plaintext = randomBytes(32).toString("hex")
  const tokenHash = hashToken(plaintext)
  await service.createPreorderTokens({
    token_hash: tokenHash,
    expires_at: expiresAt,
  })

  return { token: plaintext, expiresAt }
}

async verifyBookmarkletToken(
  plaintext: string,
): Promise<
  | { valid: true; tokenId: string }
  | { valid: false; reason: "unknown" | "revoked" | "expired" }
> {
  if (!plaintext || typeof plaintext !== "string") {
    return { valid: false, reason: "unknown" }
  }
  const tokenHash = hashToken(plaintext)
  const service = this as unknown as {
    listPreorderTokens: (
      filters: Record<string, unknown>,
    ) => Promise<
      Array<{
        id: string
        revoked_at: Date | null
        expires_at: Date | null
      }>
    >
    updatePreorderTokens: (
      input: Record<string, unknown> & { id: string },
    ) => Promise<unknown>
  }
  const rows = await service.listPreorderTokens({ token_hash: tokenHash })
  if (rows.length === 0) return { valid: false, reason: "unknown" }
  const row = rows[0]
  if (row.revoked_at) return { valid: false, reason: "revoked" }
  if (row.expires_at && row.expires_at < new Date()) {
    return { valid: false, reason: "expired" }
  }
  await service.updatePreorderTokens({
    id: row.id,
    last_used_at: new Date(),
  })
  return { valid: true, tokenId: row.id }
}

async revokeBookmarkletToken(): Promise<void> {
  const service = this as unknown as {
    listPreorderTokens: (
      filters: Record<string, unknown>,
    ) => Promise<Array<{ id: string }>>
    updatePreorderTokens: (
      input: Record<string, unknown> & { id: string },
    ) => Promise<unknown>
  }
  const active = await service.listPreorderTokens({ revoked_at: null })
  for (const row of active) {
    await service.updatePreorderTokens({
      id: row.id,
      revoked_at: new Date(),
    })
  }
}

async getActiveTokenInfo(): Promise<
  | { active: false }
  | {
      active: true
      expiresAt: Date | null
      lastUsedAt: Date | null
      createdAt: Date
    }
> {
  const service = this as unknown as {
    listPreorderTokens: (
      filters: Record<string, unknown>,
      config?: Record<string, unknown>,
    ) => Promise<
      Array<{
        expires_at: Date | null
        last_used_at: Date | null
        created_at: Date
        revoked_at: Date | null
      }>
    >
  }
  const rows = await service.listPreorderTokens(
    { revoked_at: null },
    { take: 1, order: { created_at: "DESC" } },
  )
  if (rows.length === 0) return { active: false }
  const row = rows[0]
  return {
    active: true,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  }
}
```

At the **module file level** (outside the class, but before `export default`), add:

```typescript
function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex")
}

// Re-export for unit tests only — not part of the public service API.
export { hashToken as hashTokenForTest }
```

- [ ] **Step 4: Run unit test**

```bash
cd Backend/dollup-medusa
yarn test:unit src/modules/preorder/__tests__/token-service.spec.ts
```

Expected: PASS (3 cases).

- [ ] **Step 5: Build to confirm no type errors**

```bash
cd Backend/dollup-medusa
yarn build
```

Expected: builds cleanly.

- [ ] **Step 6: Commit**

```bash
cd Backend/dollup-medusa
git add src/modules/preorder/service.ts src/modules/preorder/__tests__/token-service.spec.ts
git commit -m "feat(preorder): bookmarklet token service methods (generate, verify, revoke)"
```

---

## Task 11: Admin route for token management (GET / POST / DELETE)

**Files:**
- Create: `Backend/dollup-medusa/src/api/admin/preorder/bookmarklet/token/route.ts`

- [ ] **Step 1: Create the route**

Create `Backend/dollup-medusa/src/api/admin/preorder/bookmarklet/token/route.ts`:

```typescript
import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../../modules/preorder"
import type PreorderModuleService from "../../../../../modules/preorder/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const info = await svc.getActiveTokenInfo()
  res.json(info)
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as { expiresInDays?: number }
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const result = await svc.generateBookmarkletToken({
    expiresInDays: body.expiresInDays,
  })
  // Plaintext returned ONCE here.
  res.json({ token: result.token, expiresAt: result.expiresAt })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  await svc.revokeBookmarkletToken()
  res.json({ revoked: true })
}
```

- [ ] **Step 2: Build to confirm no type errors**

```bash
cd Backend/dollup-medusa
yarn build
```

Expected: builds cleanly.

- [ ] **Step 3: Commit**

```bash
cd Backend/dollup-medusa
git add src/api/admin/preorder/bookmarklet/token/
git commit -m "feat(preorder): admin token CRUD route"
```

---

## Task 12: Token-authed bookmarklet import route

**Files:**
- Create: `Backend/dollup-medusa/src/api/admin/preorder/bookmarklet/route.ts`
- Modify: `Backend/dollup-medusa/src/api/middlewares.ts` (create if doesn't exist)

- [ ] **Step 1: Check middlewares file**

```bash
ls Backend/dollup-medusa/src/api/middlewares.ts
```

If it doesn't exist, create it with:

```typescript
import { defineMiddlewares } from "@medusajs/medusa"

export default defineMiddlewares({
  routes: [
    {
      // The bookmarklet route uses its own header-based token auth — skip the
      // admin session middleware so unauthenticated CORS POSTs from shein.com
      // reach the handler.
      matcher: "/admin/preorder/bookmarklet",
      method: ["POST", "OPTIONS"],
      middlewares: [],
    },
  ],
})
```

If it DOES exist, open it and merge the route entry above into the existing `routes` array. Don't disturb any other entries.

- [ ] **Step 2: Create the route**

Create `Backend/dollup-medusa/src/api/admin/preorder/bookmarklet/route.ts`:

```typescript
import type {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../modules/preorder"
import type PreorderModuleService from "../../../../modules/preorder/service"
import { createPreorderProduct } from "../lib/create-preorder-product"

const STOREFRONT_URL =
  process.env.PREORDER_STOREFRONT_URL ?? "https://preorder.dollupboutique.com"

type BookmarkletBody = {
  title?: string
  sheinUrl?: string
  sheinPriceUsd?: number
  description?: string
  sizes?: string[]
  colors?: Array<{ name: string; images: string[] }>
  bookmarkletVersion?: string
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const PREORDER_SALES_CHANNEL_ID = process.env.PREORDER_SALES_CHANNEL_ID
  if (!PREORDER_SALES_CHANNEL_ID) {
    res.status(500).json({
      message: "PREORDER_SALES_CHANNEL_ID env var is not set on the backend.",
    })
    return
  }

  const tokenHeader = req.headers["x-preorder-bookmarklet-token"]
  const token =
    typeof tokenHeader === "string"
      ? tokenHeader
      : Array.isArray(tokenHeader)
        ? tokenHeader[0]
        : ""
  if (!token) {
    res.status(401).json({ message: "missing x-preorder-bookmarklet-token header" })
    return
  }

  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const verdict = await svc.verifyBookmarkletToken(token)
  if (!verdict.valid) {
    res.status(401).json({ message: `token ${verdict.reason}` })
    return
  }

  const body = (req.body ?? {}) as BookmarkletBody
  const errors: string[] = []
  if (!body.title || typeof body.title !== "string") errors.push("title required")
  if (!body.sheinUrl || typeof body.sheinUrl !== "string") errors.push("sheinUrl required")
  if (typeof body.sheinPriceUsd !== "number" || !(body.sheinPriceUsd > 0)) {
    errors.push("sheinPriceUsd must be a positive number")
  }
  if (
    !Array.isArray(body.colors) ||
    body.colors.length === 0 ||
    typeof body.colors[0] !== "object"
  ) {
    errors.push("colors required as Array<{name, images}>")
  }
  if (errors.length > 0) {
    res.status(400).json({ message: errors.join("; ") })
    return
  }
  if (!/(^https?:\/\/)(m\.)?shein\.com\//i.test(body.sheinUrl!)) {
    res.status(400).json({ message: "sheinUrl must be a shein.com URL" })
    return
  }

  try {
    const result = await createPreorderProduct(
      req.scope,
      {
        title: body.title!,
        sheinUrl: body.sheinUrl!,
        sheinPriceUsd: body.sheinPriceUsd!,
        description: body.description,
        sizes: body.sizes,
        colors: body.colors,
      },
      PREORDER_SALES_CHANNEL_ID,
    )
    const storefrontUrl = `${STOREFRONT_URL}/preorder/products/${result.product.handle}`
    res.json({ product: result.product, storefrontUrl, preview: result.preview })
  } catch (err: any) {
    res.status(400).json({ message: err?.message ?? "create failed" })
  }
}
```

- [ ] **Step 3: Build to confirm no type errors**

```bash
cd Backend/dollup-medusa
yarn build
```

Expected: builds cleanly.

- [ ] **Step 4: Commit**

```bash
cd Backend/dollup-medusa
git add src/api/admin/preorder/bookmarklet/route.ts src/api/middlewares.ts
git commit -m "feat(preorder): token-authed /admin/preorder/bookmarklet POST"
```

---

## Task 13: Push backend + verify token endpoints with curl

**Files:** none — manual test.

- [ ] **Step 1: Push**

```bash
cd Backend/dollup-medusa
git push origin master
```

Wait for Coolify to deploy.

- [ ] **Step 2: Generate a token via curl (using your admin session cookie)**

In your browser, log into `api.dollupboutique.com/app`. Open DevTools → Application → Cookies → copy the value of `connect.sid` (or whichever session cookie Medusa uses).

```bash
curl -s -X POST "https://api.dollupboutique.com/admin/preorder/bookmarklet/token" \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=<YOUR_COOKIE>" \
  -d '{}'
```

Expected: JSON `{ token: "<64-hex>", expiresAt: "<ISO>" }`. Save the token — you'll use it in step 3.

- [ ] **Step 3: Test the bookmarklet POST with curl**

```bash
curl -s -X POST "https://api.dollupboutique.com/admin/preorder/bookmarklet" \
  -H "Content-Type: application/json" \
  -H "x-preorder-bookmarklet-token: <THE_TOKEN_FROM_STEP_2>" \
  -d '{
    "title": "Curl Test Dress",
    "sheinUrl": "https://shein.com/test-product-p-12345.html",
    "sheinPriceUsd": 15,
    "sizes": ["S","M"],
    "colors": [
      {"name":"Red","images":["https://img.ltwebstatic.com/test1.jpg"]},
      {"name":"Blue","images":["https://img.ltwebstatic.com/test2.jpg"]}
    ],
    "bookmarkletVersion": "1.0.0"
  }'
```

Expected: `{"product":{"id":"prod_...","handle":"curl-test-dress-preorder-..."},"storefrontUrl":"https://preorder.dollupboutique.com/preorder/products/...","preview":{...}}`.

- [ ] **Step 4: Verify on the storefront**

Visit the returned `storefrontUrl`. Page should load, show "Red" and "Blue" swatches, gallery swaps when you click.

- [ ] **Step 5: Delete the test product**

In Medusa admin → Products → search "Curl Test Dress" → delete. (Or leave a TODO in admin to clean up after smoke.)

- [ ] **Step 6: Mark backend Phase 2 done**

Backend bookmarklet path works. Continue.

---

## Task 14: Update CORS in Coolify to allow shein.com origins

**Files:** none — Coolify env config.

- [ ] **Step 1: Open Coolify → backend service → Environment variables → `ADMIN_CORS`**

Current value (likely): `https://dollup-admin.dollupboutique.com` or similar.

- [ ] **Step 2: Append SHEIN origins (comma-separated)**

New value:
```
https://dollup-admin.dollupboutique.com,https://shein.com,https://www.shein.com,https://m.shein.com,https://us.shein.com
```

- [ ] **Step 3: Save and redeploy**

Coolify "Save" → "Redeploy". ~2 min.

- [ ] **Step 4: Verify CORS preflight from shein.com origin**

```bash
curl -s -i -X OPTIONS "https://api.dollupboutique.com/admin/preorder/bookmarklet" \
  -H "Origin: https://www.shein.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: x-preorder-bookmarklet-token,content-type"
```

Expected: response includes `Access-Control-Allow-Origin: https://www.shein.com` AND `Access-Control-Allow-Headers: ...x-preorder-bookmarklet-token...`.

If `Access-Control-Allow-Headers` doesn't include the custom header, edit Medusa CORS config to add it (see Medusa v2 CORS docs). Typically not needed — Medusa allows `x-*` by default.

---

## Task 15: Bookmarklet JS source (dollup-admin/public)

**Files:**
- Create: `dollup-admin/public/preorder-bookmarklet.js`

- [ ] **Step 1: Write the bookmarklet**

Create `dollup-admin/public/preorder-bookmarklet.js`:

```javascript
/**
 * Doll Up — SHEIN to Pre-Order bookmarklet.
 *
 * The token gets injected into the `__BOOKMARKLET_TOKEN__` placeholder at the
 * moment the admin page builds the draggable URL. DO NOT commit a real token
 * here — the placeholder is replaced by lib/build-bookmarklet.ts.
 */
(function () {
  var TOKEN = "__BOOKMARKLET_TOKEN__";
  var API = "https://api.dollupboutique.com/admin/preorder/bookmarklet";
  var VERSION = "1.0.0";

  function toast(message, kind) {
    var existing = document.getElementById("dub-bookmarklet-toast");
    if (existing) existing.remove();
    var el = document.createElement("div");
    el.id = "dub-bookmarklet-toast";
    el.style.cssText =
      "position:fixed;top:24px;right:24px;z-index:2147483647;" +
      "padding:14px 18px;border-radius:8px;font:14px system-ui,sans-serif;" +
      "color:#fff;max-width:360px;box-shadow:0 8px 24px rgba(0,0,0,.2);" +
      "background:" +
      (kind === "error" ? "#b91c1c" : kind === "success" ? "#15803d" : "#1f2937");
    el.innerHTML = message;
    document.body.appendChild(el);
    if (kind !== "info") {
      setTimeout(function () {
        el.remove();
      }, 10000);
    }
  }

  function extractFromSsr() {
    var ssr = window.gbProductSsrData;
    if (!ssr || !ssr.productIntroData) return null;
    var intro = ssr.productIntroData;
    var detail = intro.detail || {};
    var title = (detail.goods_name || "").trim();
    if (!title) return null;
    var priceCandidates = [
      detail.salePrice && detail.salePrice.amount,
      detail.sale_price && detail.sale_price.amount,
      detail.retailPrice && detail.retailPrice.amount,
      detail.retail_price && detail.retail_price.amount,
    ];
    var priceUsd = NaN;
    for (var i = 0; i < priceCandidates.length; i++) {
      var c = priceCandidates[i];
      var n = typeof c === "string" ? parseFloat(c) : typeof c === "number" ? c : NaN;
      if (isFinite(n) && n > 0) {
        priceUsd = n;
        break;
      }
    }
    if (!isFinite(priceUsd) || priceUsd <= 0) return null;

    // sizes
    var sizes = [];
    var skuRel = (detail.sku_relation_info || []);
    var seenSize = {};
    for (var s = 0; s < skuRel.length; s++) {
      var attrs = skuRel[s].attr_value_list || [];
      for (var a = 0; a < attrs.length; a++) {
        if (attrs[a].attr_name === "Size" && attrs[a].attr_value_name) {
          if (!seenSize[attrs[a].attr_value_name]) {
            seenSize[attrs[a].attr_value_name] = true;
            sizes.push(attrs[a].attr_value_name);
          }
        }
      }
    }

    // colors with per-color image lists
    var colors = [];
    var rel = intro.relation_color || [];
    function collectImages(src) {
      var out = [];
      function push(u) {
        if (typeof u !== "string") return;
        var t = u.trim();
        if (!/^https:\/\/img\.ltwebstatic\.com\//.test(t)) return;
        if (out.indexOf(t) === -1) out.push(t);
      }
      push(src.goods_thumb);
      push(src.goods_img);
      var dim = src.detail_image || src.detailImage || [];
      for (var d = 0; d < dim.length; d++) {
        push((dim[d] && (dim[d].origin_image || dim[d].url)) || dim[d]);
      }
      var gim = src.image_list || src.imageList || [];
      for (var g = 0; g < gim.length; g++) {
        push((gim[g] && (gim[g].origin_image || gim[g].url)) || gim[g]);
      }
      return out;
    }
    if (rel && rel.length > 0) {
      for (var r = 0; r < rel.length; r++) {
        var name = (rel[r].color_name || rel[r].goods_color_name || "").trim();
        var imgs = collectImages(rel[r]);
        if (name && imgs.length > 0) colors.push({ name: name, images: imgs });
      }
    }
    if (colors.length === 0) {
      var fallback = collectImages(detail);
      if (fallback.length > 0) {
        colors.push({
          name: (detail.color_name || "Default").trim() || "Default",
          images: fallback,
        });
      }
    }
    if (colors.length === 0) return null;

    return { title: title, sheinPriceUsd: priceUsd, sizes: sizes, colors: colors };
  }

  function extractFromJsonLd() {
    var scripts = document.querySelectorAll(
      'script[type="application/ld+json"]',
    );
    for (var i = 0; i < scripts.length; i++) {
      try {
        var data = JSON.parse(scripts[i].textContent || "{}");
        var product = pickProduct(data);
        if (!product) continue;
        var title = (product.name || "").trim();
        if (!title) continue;
        var offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        var priceUsd =
          offers && (typeof offers.price === "string"
            ? parseFloat(offers.price)
            : typeof offers.price === "number"
              ? offers.price
              : NaN);
        if (!isFinite(priceUsd) || priceUsd <= 0) continue;
        var img = product.image;
        var images = Array.isArray(img)
          ? img.filter(function (u) {
              return typeof u === "string" && /^https:\/\/img\.ltwebstatic\.com\//.test(u);
            })
          : typeof img === "string" && /^https:\/\/img\.ltwebstatic\.com\//.test(img)
            ? [img]
            : [];
        if (images.length === 0) continue;
        return {
          title: title,
          sheinPriceUsd: priceUsd,
          sizes: [],
          colors: [{ name: "Default", images: images }],
        };
      } catch (e) {}
    }
    return null;
  }

  function pickProduct(data) {
    if (!data) return null;
    if (Array.isArray(data)) {
      for (var i = 0; i < data.length; i++) {
        var p = pickProduct(data[i]);
        if (p) return p;
      }
      return null;
    }
    if (typeof data === "object") {
      if (data["@type"] === "Product") return data;
      if (Array.isArray(data["@graph"])) return pickProduct(data["@graph"]);
    }
    return null;
  }

  try {
    var host = location.hostname.toLowerCase();
    if (host.indexOf("shein.com") === -1) {
      toast("Not a SHEIN page", "error");
      return;
    }
    var data = extractFromSsr() || extractFromJsonLd();
    if (!data) {
      toast("Couldn't read this page — open admin manually", "error");
      return;
    }
    toast("Publishing…", "info");
    fetch(API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-preorder-bookmarklet-token": TOKEN,
      },
      body: JSON.stringify({
        title: data.title,
        sheinUrl: location.href,
        sheinPriceUsd: data.sheinPriceUsd,
        sizes: data.sizes,
        colors: data.colors,
        bookmarkletVersion: VERSION,
      }),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, body: j };
        });
      })
      .then(function (x) {
        if (!x.ok) {
          toast("Failed: " + (x.body.message || "unknown"), "error");
          return;
        }
        toast(
          "Published ✓ <a href=\"" +
            x.body.storefrontUrl +
            "\" target=\"_blank\" style=\"color:#fff;text-decoration:underline\">View →</a>",
          "success",
        );
      })
      .catch(function (err) {
        toast("Failed: " + err.message, "error");
      });
  } catch (err) {
    toast("Bookmarklet error: " + err.message, "error");
  }
})();
```

- [ ] **Step 2: Commit**

```bash
cd dollup-admin
git add public/preorder-bookmarklet.js
git commit -m "feat(preorder): bookmarklet JS source (gbProductSsrData + JSON-LD fallback)"
```

---

## Task 16: Build-bookmarklet helper (dollup-admin)

**Files:**
- Create: `dollup-admin/src/lib/build-bookmarklet.ts`

- [ ] **Step 1: Write the helper**

Create `dollup-admin/src/lib/build-bookmarklet.ts`:

```typescript
import "server-only"

import { readFileSync } from "fs"
import { join } from "path"

/**
 * Reads the bookmarklet JS source, injects the user's token, returns a
 * `javascript:...` URL safe to put in an `<a href>`.
 *
 * The source file lives in `public/` so it's also served raw at
 * `/preorder-bookmarklet.js` for debugging — but the draggable bookmarklet
 * url uses the minified+inlined form built here.
 */
export function buildBookmarkletHref(token: string): string {
  const src = readFileSync(
    join(process.cwd(), "public", "preorder-bookmarklet.js"),
    "utf8",
  )
  const injected = src.replace("__BOOKMARKLET_TOKEN__", token)
  const minified = injected
    .replace(/^\s*\/\/[^\n]*$/gm, "")  // strip line comments
    .replace(/\/\*[\s\S]*?\*\//g, "")   // strip block comments
    .replace(/\s+/g, " ")               // collapse whitespace
    .trim()
  return "javascript:" + encodeURIComponent(minified)
}
```

- [ ] **Step 2: Typecheck**

```bash
cd dollup-admin
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd dollup-admin
git add src/lib/build-bookmarklet.ts
git commit -m "feat(preorder): build-bookmarklet helper inlines token + minifies"
```

---

## Task 17: Admin settings page for bookmarklet token

**Files:**
- Create: `dollup-admin/src/app/settings/preorder-bookmarklet/page.tsx`
- Create: `dollup-admin/src/app/settings/preorder-bookmarklet/PreorderBookmarkletClient.tsx`

- [ ] **Step 1: Create the server page**

Create `dollup-admin/src/app/settings/preorder-bookmarklet/page.tsx`:

```tsx
import { PreorderBookmarkletClient } from "./PreorderBookmarkletClient";

export default function PreorderBookmarkletSettingsPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <header>
        <h1 className="font-display text-3xl text-ink">Pre-Order Bookmarklet</h1>
        <p className="mt-2 text-[14px] text-ink-soft">
          One-click import from any SHEIN product page. Generate a token, drag
          the bookmarklet to your bookmarks bar, then click it whenever you're
          on a SHEIN PDP to publish the product to{" "}
          <code>preorder.dollupboutique.com</code>.
        </p>
      </header>
      <PreorderBookmarkletClient />
    </main>
  );
}
```

- [ ] **Step 2: Create the client component**

Create `dollup-admin/src/app/settings/preorder-bookmarklet/PreorderBookmarkletClient.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

type TokenInfo =
  | { active: false }
  | {
      active: true;
      expiresAt: string | null;
      lastUsedAt: string | null;
      createdAt: string;
    };

export function PreorderBookmarkletClient() {
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [bookmarkletHref, setBookmarkletHref] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch("/api/preorder-bookmarklet/token", { method: "GET" });
      const j: TokenInfo = await r.json();
      setInfo(j);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/preorder-bookmarklet/token", { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        setError(j.message || "Failed");
        return;
      }
      setToken(j.token);
      // Also fetch the inlined bookmarklet href from a small server route.
      const r2 = await fetch(
        "/api/preorder-bookmarklet/build?token=" + encodeURIComponent(j.token),
      );
      const j2 = await r2.json();
      setBookmarkletHref(j2.href);
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  async function revoke() {
    if (!confirm("Revoke the current bookmarklet token? Existing bookmarklets will stop working.")) return;
    setLoading(true);
    try {
      await fetch("/api/preorder-bookmarklet/token", { method: "DELETE" });
      setToken(null);
      setBookmarkletHref(null);
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  if (loading && !info) return <p className="text-ink-muted">Loading…</p>;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-blush-200 bg-white p-6">
        <h2 className="font-display text-xl text-ink">Token status</h2>
        {info?.active ? (
          <dl className="mt-3 grid grid-cols-2 gap-y-1 text-[13px]">
            <dt className="text-ink-muted">Created</dt>
            <dd>{new Date(info.createdAt).toLocaleString()}</dd>
            <dt className="text-ink-muted">Expires</dt>
            <dd>{info.expiresAt ? new Date(info.expiresAt).toLocaleString() : "never"}</dd>
            <dt className="text-ink-muted">Last used</dt>
            <dd>{info.lastUsedAt ? new Date(info.lastUsedAt).toLocaleString() : "never"}</dd>
          </dl>
        ) : (
          <p className="mt-3 text-ink-soft">No active token. Generate one below.</p>
        )}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="rounded bg-ink px-4 py-2 text-[13px] font-semibold text-cream disabled:opacity-50"
          >
            {info?.active ? "Generate new (revokes current)" : "Generate token"}
          </button>
          {info?.active && (
            <button
              type="button"
              onClick={revoke}
              disabled={loading}
              className="rounded border border-coral-500 px-4 py-2 text-[13px] font-semibold text-coral-500 disabled:opacity-50"
            >
              Revoke
            </button>
          )}
        </div>
        {error && <p className="mt-3 text-[13px] text-coral-700">{error}</p>}
      </section>

      {token && (
        <section className="rounded-lg border-2 border-coral-300 bg-coral-50 p-6">
          <h2 className="font-display text-xl text-ink">Your new token (shown ONCE)</h2>
          <p className="mt-2 text-[13px] text-ink-soft">
            Copy this if you need it again later. We won't be able to show it
            after you leave this page.
          </p>
          <code className="mt-3 block break-all rounded bg-white p-3 font-mono text-[12px]">
            {token}
          </code>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(token)}
            className="mt-2 text-[12px] underline"
          >
            Copy to clipboard
          </button>
        </section>
      )}

      {bookmarkletHref && (
        <section className="rounded-lg border border-sage-200 bg-sage-50 p-6">
          <h2 className="font-display text-xl text-ink">Install the bookmarklet</h2>
          <p className="mt-2 text-[13px] text-ink-soft">
            <strong>Drag</strong> this link to your browser's bookmarks bar.
            Then on any SHEIN product page, click it.
          </p>
          <p className="mt-4">
            <a
              href={bookmarkletHref}
              onClick={(e) => e.preventDefault()}
              className="inline-block rounded-full border-2 border-dashed border-sage-700 bg-white px-5 py-3 font-semibold text-sage-700"
            >
              📌 Add SHEIN to Pre-Order
            </a>
          </p>
          <p className="mt-3 text-[12px] text-ink-muted">
            (Clicking it here on the admin page does nothing — the bookmarklet
            only works when clicked from a SHEIN tab.)
          </p>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create the proxy API routes (admin → Medusa backend)**

The admin runs on Next.js. The Medusa backend is at `api.dollupboutique.com`. Calls from the browser to `/api/preorder-bookmarklet/token` go through a Next.js route that adds the admin session cookie (same pattern as other admin pages).

Create `dollup-admin/src/app/api/preorder-bookmarklet/token/route.ts`:

```typescript
import { NextResponse } from "next/server"
import { getAdminSdk } from "@/lib/medusa-admin"

export async function GET() {
  const sdk = await getAdminSdk()
  const j = await sdk.client.fetch("/admin/preorder/bookmarklet/token", {
    method: "GET",
  })
  return NextResponse.json(j)
}

export async function POST(req: Request) {
  const sdk = await getAdminSdk()
  const body = await req.json().catch(() => ({}))
  const j = await sdk.client.fetch("/admin/preorder/bookmarklet/token", {
    method: "POST",
    body,
  })
  return NextResponse.json(j)
}

export async function DELETE() {
  const sdk = await getAdminSdk()
  const j = await sdk.client.fetch("/admin/preorder/bookmarklet/token", {
    method: "DELETE",
  })
  return NextResponse.json(j)
}
```

Create `dollup-admin/src/app/api/preorder-bookmarklet/build/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server"
import { buildBookmarkletHref } from "@/lib/build-bookmarklet"

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")
  if (!token) {
    return NextResponse.json({ message: "token required" }, { status: 400 })
  }
  return NextResponse.json({ href: buildBookmarkletHref(token) })
}
```

- [ ] **Step 4: Add the page to the sidebar navigation**

Find dollup-admin's sidebar config (likely `src/lib/nav.ts` or similar). Look at how `/settings/loyalty` or `/settings/sourcing` is registered. Mirror that to add `/settings/preorder-bookmarklet` with label "Pre-Order Bookmarklet".

If you can't find a central nav config, grep:

```bash
cd dollup-admin
grep -rn "settings/loyalty\|Loyalty" src/components/ src/lib/ | head -5
```

Add `/settings/preorder-bookmarklet` with the same pattern.

- [ ] **Step 5: Typecheck + build**

```bash
cd dollup-admin
npx tsc --noEmit
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd dollup-admin
git add src/app/settings/preorder-bookmarklet/ src/app/api/preorder-bookmarklet/
git commit -m "feat(preorder): admin settings page to generate token + drag bookmarklet"
```

---

## Task 18: Phase 2 end-to-end smoke

**Files:** none — manual test.

- [ ] **Step 1: Push admin**

```bash
cd dollup-admin
git push origin master
```

Wait for Coolify redeploy.

- [ ] **Step 2: Generate a token via the new UI**

Open dollup-admin → Settings → Pre-Order Bookmarklet → click "Generate token". Verify:
- Token block appears (copy button works)
- Bookmarklet link appears below
- Token status shows "Created" / "Expires" / "Last used: never"

- [ ] **Step 3: Drag the bookmarklet to your bookmarks bar**

Right-click the bookmarklet link → "Bookmark this link" OR drag to bookmarks bar. Name it "DUB SHEIN→Preorder".

- [ ] **Step 4: Test on a real SHEIN page**

Open `https://www.shein.com/` → pick any product → on the PDP, click the bookmarklet bookmark. Expected sequence:
- Gray toast "Publishing…"
- Green toast "Published ✓ View →" with link

Click "View →" — verify the product loads on `preorder.dollupboutique.com` with all colors and per-color images.

- [ ] **Step 5: Test error path — invalidate the token**

In admin → Settings → Pre-Order Bookmarklet → click "Revoke". Go back to SHEIN, click the bookmarklet. Expected: red toast "Failed: token revoked".

Re-generate, install new bookmarklet (drag again, removing the old one).

- [ ] **Step 6: Mark Phase 2 done**

If smoke passes: bookmarklet shipped. Continue to Phase 3.

---

# Phase 3 — Daily SHEIN availability check

## Task 19: Telegram message templates for availability check

**Files:**
- Create: `Backend/dollup-medusa/src/lib/preorder-availability-messages.ts`
- Create: `Backend/dollup-medusa/src/lib/__tests__/preorder-availability-messages.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `Backend/dollup-medusa/src/lib/__tests__/preorder-availability-messages.spec.ts`:

```typescript
import {
  outOfStockMessage,
  removedMessage,
  needsManualCheckMessage,
  circuitBreakMessage,
} from "../preorder-availability-messages"

describe("preorder availability messages", () => {
  it("formats out-of-stock with title + URL", () => {
    const m = outOfStockMessage({
      title: "Floral Dress",
      handle: "floral-dress-preorder-abc",
      sheinUrl: "https://shein.com/x",
    })
    expect(m).toContain("Floral Dress")
    expect(m).toContain("https://shein.com/x")
    expect(m).toMatch(/sold out|unavailable|stock/i)
  })

  it("formats 404 removed message", () => {
    const m = removedMessage({
      title: "X",
      handle: "x",
      sheinUrl: "https://shein.com/x",
    })
    expect(m).toContain("removed")
    expect(m).toContain("X")
  })

  it("formats manual-check message after N failures", () => {
    const m = needsManualCheckMessage(
      { title: "T", handle: "h", sheinUrl: "https://shein.com/t" },
      3,
    )
    expect(m).toContain("3")
    expect(m).toContain("T")
  })

  it("formats circuit-break summary", () => {
    const m = circuitBreakMessage(8, 12, [
      "Dress A", "Top B", "Skirt C",
    ])
    expect(m).toContain("8")
    expect(m).toContain("12")
    expect(m).toContain("Dress A")
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd Backend/dollup-medusa
yarn test:unit src/lib/__tests__/preorder-availability-messages.spec.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `Backend/dollup-medusa/src/lib/preorder-availability-messages.ts`:

```typescript
import { escapeTelegramHtml } from "./telegram"

const STOREFRONT_URL =
  process.env.PREORDER_STOREFRONT_URL ?? "https://preorder.dollupboutique.com"

type ProductCtx = {
  title: string
  handle: string
  sheinUrl: string
}

export function outOfStockMessage(p: ProductCtx): string {
  return [
    "🚨 <b>Pre-order moved to draft — SHEIN sold out</b>",
    "",
    `Product: <b>${escapeTelegramHtml(p.title)}</b>`,
    `SHEIN: ${escapeTelegramHtml(p.sheinUrl)}`,
    `Was at: ${STOREFRONT_URL}/preorder/products/${escapeTelegramHtml(p.handle)}`,
  ].join("\n")
}

export function removedMessage(p: ProductCtx): string {
  return [
    "🚨 <b>Pre-order moved to draft — SHEIN URL returned 404 (removed)</b>",
    "",
    `Product: <b>${escapeTelegramHtml(p.title)}</b>`,
    `SHEIN (gone): ${escapeTelegramHtml(p.sheinUrl)}`,
  ].join("\n")
}

export function needsManualCheckMessage(
  p: ProductCtx,
  consecutiveFailures: number,
): string {
  return [
    `⚠️ <b>Pre-order needs manual check (${consecutiveFailures} failed daily checks)</b>`,
    "",
    `Product: <b>${escapeTelegramHtml(p.title)}</b>`,
    `SHEIN: ${escapeTelegramHtml(p.sheinUrl)}`,
    "",
    "Likely cause: anti-bot blocking. Open the SHEIN URL in your browser and run the bookmarklet manually to confirm the product is still available.",
  ].join("\n")
}

export function circuitBreakMessage(
  blocked: number,
  total: number,
  sampleTitles: string[],
): string {
  return [
    `🚨 <b>Daily SHEIN check tripped circuit breaker</b>`,
    "",
    `${blocked} of ${total} products got 403/429 from SHEIN (>30% threshold).`,
    "Did NOT move anything to draft — likely just temporary anti-bot block.",
    "",
    "Sample affected products:",
    ...sampleTitles.slice(0, 5).map((t) => `• ${escapeTelegramHtml(t)}`),
    "",
    "If this persists for 3+ days, switch to the local-laptop daemon fallback (see docs/LOCAL-AVAILABILITY-DAEMON-SETUP.md when it ships).",
  ].join("\n")
}
```

- [ ] **Step 4: Run tests**

```bash
cd Backend/dollup-medusa
yarn test:unit src/lib/__tests__/preorder-availability-messages.spec.ts
```

Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
cd Backend/dollup-medusa
git add src/lib/preorder-availability-messages.ts src/lib/__tests__/preorder-availability-messages.spec.ts
git commit -m "feat(preorder): telegram message templates for availability check"
```

---

## Task 20: Availability check job

**Files:**
- Create: `Backend/dollup-medusa/src/jobs/preorder-availability-check.ts`

- [ ] **Step 1: Create the job**

Create `Backend/dollup-medusa/src/jobs/preorder-availability-check.ts`:

```typescript
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { extractFromShein } from "../lib/shein-extract"
import {
  outOfStockMessage,
  removedMessage,
  needsManualCheckMessage,
  circuitBreakMessage,
} from "../lib/preorder-availability-messages"
import { sendTelegram } from "../lib/telegram"

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
const FETCH_TIMEOUT_MS = 10_000
const CIRCUIT_BREAK_THRESHOLD = 0.3  // 30%
const FAILURE_ALERT_THRESHOLD = 3

type ProductRow = {
  id: string
  title: string
  handle: string
  status: string
  metadata: Record<string, any> | null
}

export default async function preorderAvailabilityCheck(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productService = container.resolve(Modules.PRODUCT)

  const { data: rows } = await query.graph({
    entity: "product",
    fields: ["id", "title", "handle", "status", "metadata"],
  })

  const preorderPublished = (rows as ProductRow[]).filter((p) => {
    const meta = p.metadata ?? {}
    return meta.is_preorder === true && p.status === "published"
  })

  logger.info(
    `[preorder-availability] checking ${preorderPublished.length} products`,
  )

  let blocked = 0
  const blockedTitles: string[] = []
  const movedToDraft: string[] = []

  for (const p of preorderPublished) {
    const sheinUrl: string | undefined = p.metadata?.shein_url
    if (!sheinUrl) {
      logger.warn(`[preorder-availability] ${p.id} has no metadata.shein_url`)
      continue
    }

    let result: CheckResult
    try {
      result = await checkSheinUrl(sheinUrl)
    } catch (err: any) {
      result = { kind: "network-error", message: err?.message ?? String(err) }
    }

    if (result.kind === "in-stock") {
      await productService.updateProducts({
        selector: { id: p.id },
        data: {
          metadata: {
            ...(p.metadata ?? {}),
            last_shein_check: new Date().toISOString(),
            shein_check_failures: 0,
          },
        },
      })
      continue
    }

    if (result.kind === "out-of-stock") {
      await productService.updateProducts({
        selector: { id: p.id },
        data: {
          status: "draft",
          metadata: {
            ...(p.metadata ?? {}),
            shein_unavailable: true,
            last_shein_check: new Date().toISOString(),
          },
        },
      })
      movedToDraft.push(p.title)
      await sendTelegram(
        outOfStockMessage({
          title: p.title,
          handle: p.handle,
          sheinUrl,
        }),
      )
      continue
    }

    if (result.kind === "removed") {
      await productService.updateProducts({
        selector: { id: p.id },
        data: {
          status: "draft",
          metadata: {
            ...(p.metadata ?? {}),
            shein_removed: true,
            last_shein_check: new Date().toISOString(),
          },
        },
      })
      movedToDraft.push(p.title)
      await sendTelegram(
        removedMessage({
          title: p.title,
          handle: p.handle,
          sheinUrl,
        }),
      )
      continue
    }

    // blocked or network-error or parse-fail — bump failure counter
    blocked++
    blockedTitles.push(p.title)
    const prevFailures: number = Number(p.metadata?.shein_check_failures ?? 0)
    const newFailures = prevFailures + 1
    await productService.updateProducts({
      selector: { id: p.id },
      data: {
        metadata: {
          ...(p.metadata ?? {}),
          last_shein_check: new Date().toISOString(),
          shein_check_failures: newFailures,
          shein_last_failure_kind: result.kind,
        },
      },
    })
    if (newFailures >= FAILURE_ALERT_THRESHOLD) {
      await sendTelegram(
        needsManualCheckMessage(
          { title: p.title, handle: p.handle, sheinUrl },
          newFailures,
        ),
      )
    }
  }

  // Circuit-break check: if >30% got blocked in a single run, alert summary.
  if (
    preorderPublished.length > 0 &&
    blocked / preorderPublished.length > CIRCUIT_BREAK_THRESHOLD
  ) {
    await sendTelegram(
      circuitBreakMessage(blocked, preorderPublished.length, blockedTitles),
    )
  }

  logger.info(
    `[preorder-availability] done. moved-to-draft=${movedToDraft.length}, blocked=${blocked}`,
  )
}

type CheckResult =
  | { kind: "in-stock" }
  | { kind: "out-of-stock" }
  | { kind: "removed" }
  | { kind: "blocked"; status: number }
  | { kind: "network-error"; message: string }
  | { kind: "parse-fail" }

async function checkSheinUrl(url: string): Promise<CheckResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    })
    if (res.status === 404) return { kind: "removed" }
    if (res.status === 403 || res.status === 429) {
      return { kind: "blocked", status: res.status }
    }
    if (!res.ok) {
      return { kind: "blocked", status: res.status }
    }
    const html = await res.text()
    const parsed = extractFromShein(html)
    if (!parsed) return { kind: "parse-fail" }
    return parsed.stockAvailable ? { kind: "in-stock" } : { kind: "out-of-stock" }
  } finally {
    clearTimeout(timeout)
  }
}

export const config = {
  name: "preorder-availability-check",
  // 06:00 Mauritius (UTC+4) = 02:00 UTC. Once daily.
  schedule: "0 2 * * *",
}
```

- [ ] **Step 2: Build to confirm no type errors**

```bash
cd Backend/dollup-medusa
yarn build
```

Expected: builds cleanly.

- [ ] **Step 3: Commit**

```bash
cd Backend/dollup-medusa
git add src/jobs/preorder-availability-check.ts
git commit -m "feat(preorder): daily 06:00 MU SHEIN availability check job"
```

---

## Task 21: Manual one-shot script for smoke-testing the job

**Files:**
- Create: `Backend/dollup-medusa/src/scripts/run-availability-check-now.ts`

- [ ] **Step 1: Create the script**

Create `Backend/dollup-medusa/src/scripts/run-availability-check-now.ts`:

```typescript
/**
 * Manual one-shot wrapper for preorder-availability-check.ts. Triggers the
 * same logic the cron will run nightly, but you control the timing.
 *
 * Run: yarn medusa exec ./src/scripts/run-availability-check-now.ts
 */
import { ExecArgs } from "@medusajs/framework/types"

import preorderAvailabilityCheck from "../jobs/preorder-availability-check"

export default async function runNow({ container }: ExecArgs) {
  await preorderAvailabilityCheck(container)
}
```

- [ ] **Step 2: Commit**

```bash
cd Backend/dollup-medusa
git add src/scripts/run-availability-check-now.ts
git commit -m "chore(preorder): manual one-shot script for availability check"
```

---

## Task 22: Phase 3 smoke test

**Files:** none — manual test.

- [ ] **Step 1: Push backend**

```bash
cd Backend/dollup-medusa
git push origin master
```

Wait for Coolify redeploy.

- [ ] **Step 2: Run the script in the backend container**

SSH into the backend container (same way you ran `setup-preorder-shipping.ts` earlier):

```bash
yarn medusa exec ./src/scripts/run-availability-check-now.ts
```

Expected logs:
- `[preorder-availability] checking N products` where N is your current preorder count
- For each, the script may report success, out-of-stock, removed, or blocked
- Final line: `[preorder-availability] done. moved-to-draft=X, blocked=Y`

- [ ] **Step 3: Check Telegram for alerts**

If any products were already sold-out on SHEIN, Telegram should have received messages. Check the bot conversation.

- [ ] **Step 4: Test the out-of-stock path manually**

Pick one of your live preorder products. Edit its `metadata.shein_url` in Medusa admin to point to a SHEIN product you KNOW is sold out (or a 404 URL like `https://shein.com/this-url-definitely-does-not-exist-404-test`). Re-run the script. Expected:
- Product moved to `status=draft` (verify in admin)
- Telegram message arrives

Restore the original URL when done.

- [ ] **Step 5: Verify the cron is registered**

Restart the Medusa server logs (or just wait for next deploy log). Look for a line like `Scheduled job "preorder-availability-check" registered with pattern "0 2 * * *"`.

- [ ] **Step 6: Mark Phase 3 done**

If smoke passes: full feature shipped. Update memory file with the rollout summary.

---

## Self-review checklist

- **Spec coverage:**
  - SHEIN parser → Task 1 ✓
  - Shared product-creation helper → Task 2 ✓
  - Refactor existing POST → Task 3 ✓
  - Per-color image storefront → Tasks 4-7 ✓
  - Token model + migration → Task 9 ✓
  - Token service → Task 10 ✓
  - Token admin route → Task 11 ✓
  - Token-authed bookmarklet route → Task 12 ✓
  - CORS update → Task 14 ✓
  - Bookmarklet JS → Task 15 ✓
  - Admin settings page → Task 17 ✓
  - Daily availability job → Tasks 19-20 ✓
  - Manual smoke script → Task 21 ✓

- **No placeholders:** Reviewed — every step has actual code or actual commands. No "TBD" / "TODO" / "fill in". The fixtures in Task 1 are the only thing I can't pre-write (they're real SHEIN HTML you capture), and Task 1 Step 1 spells out exactly what to capture.

- **Type consistency:** `ExtractedShein`/`ExtractedColor` in Task 1 → `CreatePreorderProductInput.colors: Array<{name, images}>` in Task 2 → `BookmarkletBody.colors` in Task 12 → admin client `colors: [{name, images}]` in Task 17 → storefront `PreorderVariant.metadata.image_urls` in Task 4 → `PreorderGallery.colorImageMap` in Task 5. All consistent.

- **Scope check:** 3 phases, each lands working software (Phase 1 ships per-color PDP; Phase 2 ships bookmarklet; Phase 3 ships cron). Each phase ends in a smoke task that you can stop at if anything's wrong.

---

## Execution

Plan complete and saved to `Backend/dollup-medusa/docs/superpowers/plans/2026-05-28-preorder-bookmarklet-and-availability.md`.

---

# REVISION 2 — 2026-05-28 night

**Reason for revision:** Initial Task 1 attempt failed because the parser was written against SHEIN's `window.gbProductSsrData` global, which no longer exists on current SHEIN PDPs (verified live). The canonical source is `<script id="goodsDetailSchema">` JSON-LD plus an inline `mainSaleAttribute.info[]` array. Multi-color extraction requires fetching each sibling color's URL from the browser session (anti-bot blocks server-side fetches but allows browser-context fetches).

**Tasks affected:** 1, 2, 12, 15, 20. Other tasks (3-11, 13, 14, 16-19, 21, 22) are unchanged.

**Probe data backing this revision:** [`docs/superpowers/plans/2026-05-28-shein-probes/`](2026-05-28-shein-probes/) — 8 numbered JSON files. Notably:
- `07-aloruh-20-colors-parsed.json` — proof that 20 colors of the Aloruh dress can be extracted from one parent page's inline `<script>` `mainSaleAttribute.info[]`
- `08-sibling-fetch-success.json` — proof that browser-context `fetch()` of a sibling URL works (1.5s, HTTP 200, full JSON-LD)

Before executing Task 1, READ THIS REVISION SECTION FIRST. The original Task 1-2-12-15-20 text in this file is superseded.

---

## Task 1 (REVISED): JSON-LD parser + mainSaleAttribute color-list extractor

**Files:**
- Create: `Backend/dollup-medusa/src/lib/shein-extract.ts`
- Create: `Backend/dollup-medusa/src/lib/__tests__/shein-extract.unit.spec.ts`
- Create: `Backend/dollup-medusa/src/lib/__tests__/fixtures/shein/aloruh-multicolor-parent.html` (real SHEIN HTML, captured via Playwright at implementation time)
- Create: `Backend/dollup-medusa/src/lib/__tests__/fixtures/shein/aloruh-light-yellow-sibling.html`
- Create: `Backend/dollup-medusa/src/lib/__tests__/fixtures/shein/amorya-single-color.html`

- [ ] **Step 1: Capture 3 real SHEIN HTML fixtures via Playwright MCP**

The plan's original "open in your browser, save HTML" step doesn't work — SHEIN's anti-bot blocks anything that's not a real browser session, but Playwright MCP IS a real browser session. Use it:

```
mcp__plugin_playwright_playwright__browser_navigate → "https://www.shein.com/Aloruh-Women-s-Floral-Print-Ruched-Halter-Neck-Mini-Dress-Fashionable-For-Dates-Summer-Dresses-For-Women-p-415495791.html"
mcp__plugin_playwright_playwright__browser_wait_for → time: 6   (let captcha auto-resolve)
mcp__plugin_playwright_playwright__browser_evaluate → () => document.documentElement.outerHTML
```

Save the returned HTML to `src/lib/__tests__/fixtures/shein/aloruh-multicolor-parent.html`. Repeat for:
- `https://www.shein.com/Aloruh-Women-s-Solid-Color-Casual-Halter-Mini-Bubble-Dress-p-373210897.html` → `aloruh-light-yellow-sibling.html` (the sibling page when you click "Light Yellow")
- `https://www.shein.com/Amorya-Women-s-Elegant-Floral-Print-Metal-Decor-Multi-Layered-Ruffle-Hem-Short-Dress-p-396808630.html` → `amorya-single-color.html` (single-color product)

These are large (each ~1.2MB) but they're the only way to test the parser realistically. Don't trim them — the inline `<script>` with `mainSaleAttribute` is buried at offset ~44000 inside a 188KB script tag, and the JSON-LD is in its own `<script id="goodsDetailSchema">`. We need the real structure.

If Playwright MCP isn't available in the execution environment, fall back to: ask the user to capture (open browser → DevTools → Network → Doc → right-click "Copy response" on the page request → paste into fixture file). The fixtures need to be real to test the parser meaningfully.

- [ ] **Step 2: Write the failing tests**

Create `Backend/dollup-medusa/src/lib/__tests__/shein-extract.unit.spec.ts`:

```typescript
import { readFileSync } from "fs"
import { join } from "path"
import {
  extractJsonLd,
  extractSiblingColors,
  buildSiblingUrl,
} from "../shein-extract"

const fixture = (name: string) =>
  readFileSync(join(__dirname, "fixtures/shein", name), "utf8")

describe("extractJsonLd", () => {
  it("parses ProductGroup from multi-color Aloruh parent (color = Orange, 6+ images)", () => {
    const html = fixture("aloruh-multicolor-parent.html")
    const pg = extractJsonLd(html)
    expect(pg).not.toBeNull()
    expect(pg!.name).toMatch(/Aloruh/i)
    expect(pg!.color).toBe("Orange")
    expect(pg!.image.length).toBeGreaterThanOrEqual(4)
    for (const url of pg!.image) {
      expect(url).toMatch(/^https:\/\/img\.ltwebstatic\.com\//)
    }
    expect(pg!.hasVariant.length).toBeGreaterThanOrEqual(2)
    const sizes = pg!.hasVariant.map((v) => v.size)
    expect(sizes).toEqual(expect.arrayContaining(["S", "M"]))
    const availabilities = new Set(
      pg!.hasVariant.map((v) => v.offers.availability),
    )
    expect(availabilities.has("https://schema.org/InStock")).toBe(true)
  })

  it("parses a sibling color's JSON-LD (Light Yellow has 4+ images)", () => {
    const html = fixture("aloruh-light-yellow-sibling.html")
    const pg = extractJsonLd(html)
    expect(pg).not.toBeNull()
    expect(pg!.color).toBe("Light Yellow")
    expect(pg!.image.length).toBeGreaterThanOrEqual(4)
  })

  it("parses a single-color product (Amorya)", () => {
    const html = fixture("amorya-single-color.html")
    const pg = extractJsonLd(html)
    expect(pg).not.toBeNull()
    expect(pg!.color.length).toBeGreaterThan(0)
    expect(pg!.image.length).toBeGreaterThanOrEqual(4)
  })

  it("returns null when no goodsDetailSchema script is present", () => {
    expect(extractJsonLd("<html><body>nothing</body></html>")).toBeNull()
  })

  it("parses available number from offers.price even when '0.00'", () => {
    const html = fixture("aloruh-multicolor-parent.html")
    const pg = extractJsonLd(html)!
    // Real prices come back as strings like "16.70"; some products report "0.00"
    // which the bookmarklet handles via DOM fallback. The parser just returns
    // what JSON-LD says.
    expect(typeof pg.hasVariant[0].offers.price).toBe("string")
  })
})

describe("extractSiblingColors", () => {
  it("extracts all 20 sibling colors from the Aloruh parent page", () => {
    const html = fixture("aloruh-multicolor-parent.html")
    const siblings = extractSiblingColors(html)
    expect(siblings.length).toBeGreaterThanOrEqual(15)
    for (const s of siblings) {
      expect(s.color_name.length).toBeGreaterThan(0)
      expect(s.goods_id).toMatch(/^\d+$/)
      expect(s.goods_url_name.length).toBeGreaterThan(0)
    }
    // Spot-check known colors exist
    const names = siblings.map((s) => s.color_name)
    expect(names).toEqual(expect.arrayContaining(["Light Yellow", "Black"]))
    // Spot-check the current page's goods_id is in the list
    const current = siblings.find((s) => s.goods_id === "415495791")
    expect(current?.color_name).toBe("Orange")
  })

  it("returns empty array on a page without mainSaleAttribute", () => {
    expect(extractSiblingColors("<html><body>nothing</body></html>")).toEqual(
      [],
    )
  })

  it("Amorya single-color page returns 0 or 1 sibling (just itself)", () => {
    const html = fixture("amorya-single-color.html")
    const siblings = extractSiblingColors(html)
    expect(siblings.length).toBeLessThanOrEqual(1)
  })
})

describe("buildSiblingUrl", () => {
  it("builds a SHEIN PDP URL from a sibling entry", () => {
    expect(
      buildSiblingUrl({
        color_name: "Light Yellow",
        goods_id: "373210897",
        goods_url_name:
          "Aloruh Women s Solid Color Casual Halter Mini Bubble Dress",
        goods_color_image: "//x",
        goods_image: "//y",
      }),
    ).toBe(
      "https://www.shein.com/Aloruh-Women-s-Solid-Color-Casual-Halter-Mini-Bubble-Dress-p-373210897.html",
    )
  })
})
```

- [ ] **Step 3: Run to verify failure**

```bash
cd Backend/dollup-medusa
yarn test:unit src/lib/__tests__/shein-extract.unit.spec.ts
```

Expected: FAIL (module not found).

- [ ] **Step 4: Implement the parser**

Create `Backend/dollup-medusa/src/lib/shein-extract.ts`:

```typescript
/**
 * Pure SHEIN PDP parser. Two responsibilities:
 *
 *  1. extractJsonLd(html) — pulls the <script id="goodsDetailSchema"> JSON-LD
 *     ProductGroup. That gives us title, single-color name, full image list,
 *     and per-variant size + price + availability. Source of truth for each
 *     SHEIN URL we crawl (parent OR sibling).
 *
 *  2. extractSiblingColors(html) — scans inline <script> blocks for the
 *     mainSaleAttribute.info[] entries. Each entry is a sibling color
 *     (different goods_id) with a usable URL slug. Used to discover all
 *     colors of a multi-color product from the page where the bookmarklet
 *     was clicked.
 *
 * No DOM dependency. Pure string-in / object-out so it's testable in Node
 * and reusable by the daily availability cron.
 */

export type SheinJsonLdVariant = {
  sku: string
  size: string
  offers: {
    price: string
    priceCurrency: string
    availability: string  // "https://schema.org/InStock" | "OutOfStock"
  }
}

export type SheinJsonLd = {
  name: string
  color: string
  productGroupID: string
  image: string[]
  hasVariant: SheinJsonLdVariant[]
}

export type SheinSiblingColor = {
  color_name: string
  goods_id: string
  goods_url_name: string
  goods_color_image: string
  goods_image: string
}

const JSON_LD_REGEX =
  /<script[^>]+id=["']goodsDetailSchema["'][^>]*>([\s\S]*?)<\/script>/

const SHEIN_CDN = /^(https?:)?\/\/img\.ltwebstatic\.com\//
const ATTR_ID_27_MARKER = '"attr_id":"27"'

export function extractJsonLd(html: string): SheinJsonLd | null {
  const match = html.match(JSON_LD_REGEX)
  if (!match) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(match[1].trim())
  } catch {
    return null
  }
  const pg = Array.isArray(parsed) ? parsed[0] : parsed
  if (!isProductGroup(pg)) return null
  return normalizeProductGroup(pg)
}

export function extractSiblingColors(html: string): SheinSiblingColor[] {
  // mainSaleAttribute lives in an inline <script> (not the JSON-LD). We don't
  // know the script's exact start, so we scan for each color object directly:
  // each is identifiable by "attr_id":"27" (the Color attribute). For each
  // hit, balance braces backward to find the object start and forward to find
  // the object end, then JSON.parse it.
  const out: SheinSiblingColor[] = []
  const seen = new Set<string>()
  let pos = 0
  while (true) {
    const idx = html.indexOf(ATTR_ID_27_MARKER, pos)
    if (idx === -1) break
    pos = idx + 1
    const objBounds = findEnclosingObject(html, idx)
    if (!objBounds) continue
    let obj: any
    try {
      obj = JSON.parse(html.slice(objBounds.start, objBounds.end))
    } catch {
      continue
    }
    if (!isSiblingColor(obj)) continue
    if (seen.has(obj.goods_id)) continue
    seen.add(obj.goods_id)
    out.push({
      color_name: String(obj.attr_value),
      goods_id: String(obj.goods_id),
      goods_url_name: String(obj.goods_url_name),
      goods_color_image: String(obj.goods_color_image ?? ""),
      goods_image: String(obj.goods_image ?? ""),
    })
  }
  return out
}

export function buildSiblingUrl(entry: SheinSiblingColor): string {
  const slug = entry.goods_url_name.trim().replace(/\s+/g, "-")
  return `https://www.shein.com/${slug}-p-${entry.goods_id}.html`
}

// -- helpers -------------------------------------------------------------

function isProductGroup(v: unknown): v is Record<string, any> {
  return (
    !!v &&
    typeof v === "object" &&
    (v as any)["@type"] === "ProductGroup" &&
    typeof (v as any).name === "string"
  )
}

function normalizeProductGroup(pg: Record<string, any>): SheinJsonLd {
  const images: string[] = Array.isArray(pg.image)
    ? pg.image.filter(
        (u: unknown): u is string => typeof u === "string" && SHEIN_CDN.test(u),
      )
    : typeof pg.image === "string" && SHEIN_CDN.test(pg.image)
      ? [pg.image]
      : []
  const variants: SheinJsonLdVariant[] = Array.isArray(pg.hasVariant)
    ? pg.hasVariant
        .filter(
          (v: any) =>
            v &&
            typeof v.size === "string" &&
            v.offers &&
            typeof v.offers.price === "string",
        )
        .map((v: any) => ({
          sku: String(v.sku ?? ""),
          size: String(v.size),
          offers: {
            price: String(v.offers.price),
            priceCurrency: String(v.offers.priceCurrency ?? "USD"),
            availability: String(
              v.offers.availability ?? "https://schema.org/InStock",
            ),
          },
        }))
    : []
  return {
    name: String(pg.name),
    color: typeof pg.color === "string" ? pg.color : "Default",
    productGroupID: String(pg.productGroupID ?? ""),
    image: images,
    hasVariant: variants,
  }
}

function isSiblingColor(v: unknown): v is Record<string, any> {
  return (
    !!v &&
    typeof v === "object" &&
    (v as any).attr_id === "27" &&
    typeof (v as any).attr_value === "string" &&
    typeof (v as any).goods_id === "string" &&
    typeof (v as any).goods_url_name === "string"
  )
}

function findEnclosingObject(
  html: string,
  innerIdx: number,
): { start: number; end: number } | null {
  // Walk backward to find the matching `{` for the object containing innerIdx.
  let depth = 0
  let start = -1
  for (let i = innerIdx; i >= 0; i--) {
    const c = html[i]
    if (c === '"') {
      // Skip a JSON string going backward — find the unescaped opening quote.
      const opener = findStringStart(html, i)
      if (opener === -1) return null
      i = opener
      continue
    }
    if (c === "}") depth++
    else if (c === "{") {
      if (depth === 0) {
        start = i
        break
      }
      depth--
    }
  }
  if (start === -1) return null
  // Walk forward to find the closing `}`.
  depth = 0
  let end = -1
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (c === '"') {
      const closer = findStringEnd(html, i)
      if (closer === -1) return null
      i = closer
      continue
    }
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  if (end === -1) return null
  return { start, end }
}

function findStringStart(html: string, closingQuoteIdx: number): number {
  // Scan backward for the opening unescaped quote.
  for (let i = closingQuoteIdx - 1; i >= 0; i--) {
    if (html[i] === '"' && !isEscaped(html, i)) return i
  }
  return -1
}

function findStringEnd(html: string, openingQuoteIdx: number): number {
  for (let i = openingQuoteIdx + 1; i < html.length; i++) {
    if (html[i] === '"' && !isEscaped(html, i)) return i
  }
  return -1
}

function isEscaped(html: string, idx: number): boolean {
  let backslashes = 0
  for (let i = idx - 1; i >= 0 && html[i] === "\\"; i--) backslashes++
  return backslashes % 2 === 1
}
```

- [ ] **Step 5: Run tests until pass**

```bash
cd Backend/dollup-medusa
yarn test:unit src/lib/__tests__/shein-extract.unit.spec.ts
```

Expected: PASS (all describe blocks). If `extractSiblingColors` returns 0 from a real fixture, the brace-balancer is mis-stepping over a string. Check fixture file is the actual captured HTML (not a stripped version) and debug the `findEnclosingObject` boundary walker.

If `extractJsonLd` fails because the JSON-LD value is wrapped in a top-level array (it usually is — `[{...}]` not `{...}`), the existing `Array.isArray(parsed) ? parsed[0] : parsed` handles it. If a fixture has neither shape, see Step 6 fallback.

- [ ] **Step 6: Commit**

```bash
cd Backend/dollup-medusa
git add src/lib/shein-extract.ts src/lib/__tests__/shein-extract.unit.spec.ts src/lib/__tests__/fixtures/shein/
git commit -m "feat(preorder): JSON-LD parser + sibling-color extractor for SHEIN"
```

---

## Task 2 (REVISED): Shared createPreorderProduct helper — multi-color via sibling-fetch

**Files:**
- Create: `Backend/dollup-medusa/src/api/admin/preorder/lib/create-preorder-product.ts`
- Create: `Backend/dollup-medusa/src/api/admin/preorder/lib/__tests__/create-preorder-product.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `Backend/dollup-medusa/src/api/admin/preorder/lib/__tests__/create-preorder-product.unit.spec.ts`:

```typescript
import { validateBookmarkletInput } from "../create-preorder-product"

describe("validateBookmarkletInput", () => {
  const valid = {
    title: "Aloruh Halter Dress",
    sheinUrl: "https://shein.com/Aloruh-p-415495791.html",
    sheinPriceUsd: 16.7,
    sizes: ["XS", "S", "M", "L"],
    colors: [
      {
        name: "Orange",
        sheinUrl: "https://shein.com/Aloruh-p-415495791.html",
        sheinGoodsId: "415495791",
        images: [
          "https://img.ltwebstatic.com/v4/orange-1.webp",
          "https://img.ltwebstatic.com/v4/orange-2.webp",
        ],
      },
      {
        name: "Light Yellow",
        sheinUrl: "https://shein.com/Aloruh-p-373210897.html",
        sheinGoodsId: "373210897",
        images: ["https://img.ltwebstatic.com/v4/yellow-1.webp"],
      },
    ],
    bookmarkletVersion: "1.0.0",
  }

  it("passes a valid multi-color payload", () => {
    expect(() => validateBookmarkletInput(valid)).not.toThrow()
  })

  it("rejects when colors is empty", () => {
    expect(() => validateBookmarkletInput({ ...valid, colors: [] })).toThrow(
      /at least one color/i,
    )
  })

  it("rejects when a color has zero images", () => {
    const bad = {
      ...valid,
      colors: [{ ...valid.colors[0], images: [] }],
    }
    expect(() => validateBookmarkletInput(bad)).toThrow(/at least one image/i)
  })

  it("rejects when a color image URL is not on the SHEIN CDN", () => {
    const bad = {
      ...valid,
      colors: [
        { ...valid.colors[0], images: ["https://evil.com/x.jpg"] },
      ],
    }
    expect(() => validateBookmarkletInput(bad)).toThrow(/img\.ltwebstatic/i)
  })

  it("rejects when sheinPriceUsd is zero or negative", () => {
    expect(() =>
      validateBookmarkletInput({ ...valid, sheinPriceUsd: 0 }),
    ).toThrow(/positive/i)
    expect(() =>
      validateBookmarkletInput({ ...valid, sheinPriceUsd: -5 }),
    ).toThrow(/positive/i)
  })

  it("rejects when sizes is empty", () => {
    expect(() => validateBookmarkletInput({ ...valid, sizes: [] })).toThrow(
      /at least one size/i,
    )
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd Backend/dollup-medusa
yarn test:unit src/api/admin/preorder/lib/__tests__/create-preorder-product.unit.spec.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the helper**

Create `Backend/dollup-medusa/src/api/admin/preorder/lib/create-preorder-product.ts`:

```typescript
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"

import { PREORDER_MODULE } from "../../../../modules/preorder"
import type PreorderModuleService from "../../../../modules/preorder/service"

const PREORDER_SHIPPING_PROFILE_NAME = "Pre-Order Shipping"
const SHEIN_CDN_REGEX = /^https:\/\/img\.ltwebstatic\.com\//

export type CreatePreorderColor = {
  name: string
  sheinUrl: string
  sheinGoodsId: string
  images: string[]
}

export type CreatePreorderProductInput = {
  title: string
  sheinUrl: string  // the URL where the bookmarklet was clicked
  sheinPriceUsd: number
  description?: string
  sizes: string[]
  colors: CreatePreorderColor[]
  bookmarkletVersion?: string
}

export type CreatePreorderProductResult = {
  product: { id: string; handle: string }
  preview: {
    sheinPriceMur: number
    finalPriceMur: number
    fxRateUsed: number
  }
  variantCount: number
  colorCount: number
}

/**
 * Pure input validator. Exported separately so it can be unit-tested without
 * spinning up the container.
 */
export function validateBookmarkletInput(input: unknown): asserts input is CreatePreorderProductInput {
  if (!input || typeof input !== "object") throw new Error("input must be an object")
  const i = input as Record<string, any>
  if (!i.title || typeof i.title !== "string") throw new Error("title required")
  if (!i.sheinUrl || typeof i.sheinUrl !== "string") throw new Error("sheinUrl required")
  if (!/(^https?:\/\/)(m\.)?shein\.com\//i.test(i.sheinUrl)) {
    throw new Error("sheinUrl must be a shein.com URL")
  }
  if (typeof i.sheinPriceUsd !== "number" || !(i.sheinPriceUsd > 0)) {
    throw new Error("sheinPriceUsd must be a positive number")
  }
  if (!Array.isArray(i.sizes) || i.sizes.length === 0) {
    throw new Error("sizes: at least one size required")
  }
  for (const s of i.sizes) {
    if (typeof s !== "string" || !s.trim()) throw new Error("sizes[] must be non-empty strings")
  }
  if (!Array.isArray(i.colors) || i.colors.length === 0) {
    throw new Error("colors: at least one color required")
  }
  for (const c of i.colors) {
    if (!c || typeof c !== "object") throw new Error("each color must be an object")
    if (!c.name || typeof c.name !== "string") throw new Error("color.name required")
    if (!c.sheinUrl || typeof c.sheinUrl !== "string") throw new Error("color.sheinUrl required")
    if (!c.sheinGoodsId || typeof c.sheinGoodsId !== "string") throw new Error("color.sheinGoodsId required")
    if (!Array.isArray(c.images) || c.images.length === 0) {
      throw new Error(`color "${c.name}" must have at least one image`)
    }
    for (const url of c.images) {
      if (typeof url !== "string" || !SHEIN_CDN_REGEX.test(url)) {
        throw new Error(`color "${c.name}" image URLs must be on img.ltwebstatic.com`)
      }
    }
  }
}

/**
 * Runs the full create + sales-channel-link flow for a multi-color pre-order
 * product. Each color contributes its own variant.metadata.image_urls so the
 * storefront PDP gallery can swap on color change.
 */
export async function createPreorderProduct(
  container: MedusaContainer,
  rawInput: unknown,
  preorderSalesChannelId: string,
): Promise<CreatePreorderProductResult> {
  validateBookmarkletInput(rawInput)
  const input = rawInput as CreatePreorderProductInput

  const svc = container.resolve<PreorderModuleService>(PREORDER_MODULE)
  const preview = await svc.previewPrice({ sheinPriceUsd: input.sheinPriceUsd })
  const settings = await svc.getSettings()

  const fulfillmentService = container.resolve(Modules.FULFILLMENT)
  const [preorderProfile] = await fulfillmentService.listShippingProfiles({
    name: PREORDER_SHIPPING_PROFILE_NAME,
  })
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any
  if (!preorderProfile) {
    logger.warn?.(
      `[create-preorder-product] Pre-Order shipping profile not found.`,
    )
  }

  const variants = input.colors.flatMap((color) =>
    input.sizes.map((size) => ({
      title: `${color.name} / ${size}`,
      sku: undefined,
      options: { Color: color.name, Size: size },
      prices: [{ currency_code: "mur", amount: preview.finalPriceMur * 100 }],
      manage_inventory: false,
      metadata: {
        image_urls: color.images,
        shein_url: color.sheinUrl,
        shein_goods_id: color.sheinGoodsId,
      },
    })),
  )

  const handle =
    input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") +
    "-preorder-" +
    Date.now().toString(36)

  const productImages = input.colors.flatMap((c) =>
    c.images.map((url) => ({ url })),
  )
  const thumbnail = input.colors[0].images[0]

  const result = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: input.title,
          handle,
          description: input.description ?? "",
          status: "published",
          images: productImages,
          thumbnail,
          options: [
            { title: "Color", values: input.colors.map((c) => c.name) },
            { title: "Size", values: input.sizes },
          ],
          variants,
          metadata: {
            is_preorder: true,
            shein_url: input.sheinUrl,
            shein_price_usd: input.sheinPriceUsd,
            preorder_fx_rate: preview.fxRateUsed,
            preorder_eta_min_days: settings.eta_min_days,
            preorder_eta_max_days: settings.eta_max_days,
            preorder_priced_at: new Date().toISOString(),
            bookmarklet_version: input.bookmarkletVersion ?? null,
          },
          sales_channels: [{ id: preorderSalesChannelId }],
          ...(preorderProfile ? { shipping_profile_id: preorderProfile.id } : {}),
        },
      ],
    },
  })

  const created = (result.result as Array<{ id: string; handle: string }>)[0]

  // Explicit channel link — see 2026-05-27 fix in memory for why the workflow
  // input alone silently no-ops.
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
  try {
    await remoteLink.create({
      [Modules.PRODUCT]: { product_id: created.id },
      [Modules.SALES_CHANNEL]: {
        sales_channel_id: preorderSalesChannelId,
      },
    })
  } catch (err: any) {
    if (
      !err?.message?.includes("already exists") &&
      !err?.message?.includes("duplicate") &&
      err?.code !== "23505"
    ) {
      logger.warn?.(
        `[create-preorder-product] channel link failed for ${created.id}: ${err?.message ?? err}`,
      )
    }
  }

  return {
    product: { id: created.id, handle: created.handle },
    preview,
    variantCount: variants.length,
    colorCount: input.colors.length,
  }
}
```

- [ ] **Step 4: Run tests until pass**

```bash
cd Backend/dollup-medusa
yarn test:unit src/api/admin/preorder/lib/__tests__/create-preorder-product.unit.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd Backend/dollup-medusa
git add src/api/admin/preorder/lib/
git commit -m "feat(preorder): multi-color createPreorderProduct + bookmarklet input validator"
```

---

## Task 12 (REVISED): Bookmarklet POST validates the multi-color shape

Identical to original Task 12 structure, only the body shape changes. Update the `BookmarkletBody` type to the multi-color shape from `CreatePreorderProductInput`. The route body becomes:

```typescript
type BookmarkletBody = {
  title?: string
  sheinUrl?: string
  sheinPriceUsd?: number
  description?: string
  sizes?: string[]
  colors?: Array<{
    name: string
    sheinUrl: string
    sheinGoodsId: string
    images: string[]
  }>
  bookmarkletVersion?: string
}
```

The shared helper's `validateBookmarkletInput` will throw on bad shapes — the route just catches that and returns 400. Original Task 12 already wraps the helper call in a try/catch, so this change is a body-shape rename.

Everything else in original Task 12 (auth, middleware, storefrontUrl response) stays the same.

---

## Task 15 (REVISED): Bookmarklet JS — JSON-LD + sibling fetch

Replace the entire bookmarklet source from the original Task 15 with:

```javascript
/**
 * Doll Up — SHEIN to Pre-Order bookmarklet (multi-color via sibling fetch).
 *
 * Strategy:
 *  1. Read JSON-LD ProductGroup from this page (current color's data).
 *  2. Read mainSaleAttribute.info[] from inline <script> (sibling color list).
 *  3. In parallel (max 8 concurrent): fetch() each sibling URL in this browser
 *     session, parse its JSON-LD, collect images.
 *  4. POST everything to /admin/preorder/bookmarklet as one product.
 *
 * The token gets injected into __BOOKMARKLET_TOKEN__ at build time by
 * dollup-admin/src/lib/build-bookmarklet.ts.
 */
(function () {
  var TOKEN = "__BOOKMARKLET_TOKEN__";
  var API = "https://api.dollupboutique.com/admin/preorder/bookmarklet";
  var VERSION = "2.0.0";
  var CONCURRENCY = 6;

  function toast(message, kind) {
    var existing = document.getElementById("dub-bookmarklet-toast");
    if (existing) existing.remove();
    var el = document.createElement("div");
    el.id = "dub-bookmarklet-toast";
    el.style.cssText =
      "position:fixed;top:24px;right:24px;z-index:2147483647;" +
      "padding:14px 18px;border-radius:8px;font:14px system-ui,sans-serif;" +
      "color:#fff;max-width:380px;box-shadow:0 8px 24px rgba(0,0,0,.2);" +
      "background:" +
      (kind === "error" ? "#b91c1c" : kind === "success" ? "#15803d" : "#1f2937");
    el.innerHTML = message;
    document.body.appendChild(el);
    if (kind !== "info") setTimeout(function () { el.remove(); }, 12000);
  }

  function extractJsonLd(html) {
    var m = html.match(
      /<script[^>]+id=["']goodsDetailSchema["'][^>]*>([\s\S]*?)<\/script>/,
    );
    if (!m) return null;
    try {
      var parsed = JSON.parse(m[1].trim());
      var pg = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!pg || pg["@type"] !== "ProductGroup") return null;
      return pg;
    } catch (e) { return null; }
  }

  function extractSiblings(html) {
    var out = [];
    var seen = {};
    var pos = 0;
    var marker = '"attr_id":"27"';
    while (true) {
      var idx = html.indexOf(marker, pos);
      if (idx === -1) break;
      pos = idx + 1;
      // backward brace balance
      var depth = 0, start = -1;
      for (var i = idx; i >= 0; i--) {
        var c = html[i];
        if (c === "}") depth++;
        else if (c === "{") {
          if (depth === 0) { start = i; break; }
          depth--;
        }
      }
      if (start === -1) continue;
      depth = 0;
      var end = -1;
      for (var j = start; j < html.length; j++) {
        var d = html[j];
        if (d === "{") depth++;
        else if (d === "}") { depth--; if (depth === 0) { end = j + 1; break; } }
      }
      if (end === -1) continue;
      try {
        var obj = JSON.parse(html.slice(start, end));
        if (obj && obj.attr_id === "27" && obj.goods_id && !seen[obj.goods_id]) {
          seen[obj.goods_id] = 1;
          out.push(obj);
        }
      } catch (e) {}
    }
    return out;
  }

  function buildUrl(entry) {
    var slug = entry.goods_url_name.trim().replace(/\s+/g, "-");
    return "https://www.shein.com/" + slug + "-p-" + entry.goods_id + ".html";
  }

  function priceFromJsonLd(pg) {
    var variants = pg.hasVariant || [];
    for (var i = 0; i < variants.length; i++) {
      var p = parseFloat(variants[i].offers && variants[i].offers.price);
      if (isFinite(p) && p > 0) return p;
    }
    return NaN;
  }

  function priceFromDom() {
    // Fallback when JSON-LD prices are "0.00" — scan visible page for $XX.XX
    var matches = document.body.innerText.match(/\$\s?(\d+\.\d{2})/);
    if (!matches) return NaN;
    var p = parseFloat(matches[1]);
    return isFinite(p) ? p : NaN;
  }

  function sizesFromJsonLd(pg) {
    var set = {};
    var variants = pg.hasVariant || [];
    for (var i = 0; i < variants.length; i++) {
      if (variants[i].size) set[variants[i].size] = 1;
    }
    return Object.keys(set);
  }

  async function fetchSibling(entry) {
    var url = buildUrl(entry);
    try {
      var res = await fetch(url, { credentials: "include" });
      if (res.url && res.url.indexOf("/risk/challenge") !== -1) {
        return { entry: entry, blocked: true };
      }
      if (!res.ok) return { entry: entry, error: "HTTP " + res.status };
      var html = await res.text();
      var pg = extractJsonLd(html);
      if (!pg) return { entry: entry, error: "no JSON-LD" };
      return {
        entry: entry,
        ok: true,
        pg: pg,
        images: pg.image || [],
        url: url,
      };
    } catch (e) {
      return { entry: entry, error: String(e) };
    }
  }

  // Run N async tasks with a concurrency cap.
  async function parallelLimit(items, limit, worker) {
    var results = new Array(items.length);
    var nextIdx = 0;
    async function runner() {
      while (true) {
        var myIdx = nextIdx++;
        if (myIdx >= items.length) return;
        results[myIdx] = await worker(items[myIdx]);
      }
    }
    var runners = [];
    for (var i = 0; i < Math.min(limit, items.length); i++) runners.push(runner());
    await Promise.all(runners);
    return results;
  }

  async function main() {
    if (location.hostname.indexOf("shein.com") === -1) {
      toast("Not a SHEIN page", "error");
      return;
    }
    var html = document.documentElement.outerHTML;
    var currentPg = extractJsonLd(html);
    if (!currentPg) {
      toast("Couldn't read this SHEIN page (no JSON-LD)", "error");
      return;
    }

    var siblings = extractSiblings(html);
    var currentGoodsId = currentPg.productGroupID || "";
    // Make sure the current page is in the colors list. If the page's goods_id
    // isn't in siblings, prepend a synthetic entry for it.
    var currentInList = false;
    var currentSheinId = (location.pathname.match(/-p-(\d+)\.html/) || [])[1] || "";
    for (var i = 0; i < siblings.length; i++) {
      if (siblings[i].goods_id === currentSheinId) { currentInList = true; break; }
    }
    if (!currentInList) {
      siblings.unshift({
        attr_id: "27",
        attr_value: currentPg.color || "Default",
        goods_id: currentSheinId,
        goods_url_name: (currentPg.name || "").replace(/[^a-zA-Z0-9 ]/g, "").trim() || "shein-product",
        goods_color_image: currentPg.image[0] || "",
        goods_image: currentPg.image[0] || "",
      });
    }

    toast("Found " + siblings.length + " color(s). Fetching gallery images…", "info");

    var siblingResults = await parallelLimit(siblings, CONCURRENCY, fetchSibling);
    var successfulColors = [];
    var failedColors = [];
    var blockedCount = 0;
    for (var i = 0; i < siblingResults.length; i++) {
      var r = siblingResults[i];
      if (r.blocked) blockedCount++;
      if (r.ok && r.images.length > 0) {
        successfulColors.push({
          name: r.entry.attr_value,
          sheinUrl: r.url,
          sheinGoodsId: r.entry.goods_id,
          images: r.images,
        });
      } else {
        failedColors.push(r.entry.attr_value);
      }
    }

    if (blockedCount > 0) {
      toast(
        "SHEIN anti-bot tripped on " + blockedCount + " color fetches. Try again in 60s.",
        "error",
      );
      return;
    }
    if (successfulColors.length === 0) {
      toast("Couldn't fetch any color galleries. Aborted.", "error");
      return;
    }

    // Price: JSON-LD first, DOM fallback
    var price = priceFromJsonLd(currentPg);
    if (!isFinite(price) || price <= 0) {
      price = priceFromDom();
    }
    if (!isFinite(price) || price <= 0) {
      toast("Couldn't determine price. Open admin manually.", "error");
      return;
    }

    var sizes = sizesFromJsonLd(currentPg);
    if (sizes.length === 0) sizes = ["One Size"];

    var body = {
      title: currentPg.name,
      sheinUrl: location.href,
      sheinPriceUsd: price,
      sizes: sizes,
      colors: successfulColors,
      bookmarkletVersion: VERSION,
    };

    toast(
      "Publishing " + successfulColors.length + " color(s) × " + sizes.length + " size(s)…",
      "info",
    );

    try {
      var res = await fetch(API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-preorder-bookmarklet-token": TOKEN,
        },
        body: JSON.stringify(body),
      });
      var j = await res.json();
      if (!res.ok) {
        toast("Failed: " + (j.message || "unknown"), "error");
        return;
      }
      var failedNote = failedColors.length > 0
        ? " (" + failedColors.length + " color(s) skipped)"
        : "";
      toast(
        "Published ✓ " + successfulColors.length + " colors × " + sizes.length + " sizes" +
          failedNote +
          " <a href=\"" + j.storefrontUrl + "\" target=\"_blank\" style=\"color:#fff;text-decoration:underline\">View →</a>",
        "success",
      );
    } catch (err) {
      toast("Failed: " + err.message, "error");
    }
  }

  try { main(); } catch (e) { toast("Bookmarklet error: " + e.message, "error"); }
})();
```

Everything else in original Task 15 (commit message, file path) stays the same.

---

## Task 20 (REVISED): Availability check uses JSON-LD availability

Replace the inner `checkSheinUrl` function with one that parses JSON-LD:

```typescript
import { extractJsonLd } from "../lib/shein-extract"

async function checkSheinUrl(url: string): Promise<CheckResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    })
    // SHEIN's anti-bot redirects to /risk/challenge — that's a "blocked" signal.
    if (res.url && res.url.includes("/risk/challenge")) {
      return { kind: "blocked", status: res.status }
    }
    if (res.status === 404) return { kind: "removed" }
    if (res.status === 403 || res.status === 429) {
      return { kind: "blocked", status: res.status }
    }
    if (!res.ok) return { kind: "blocked", status: res.status }
    const html = await res.text()
    const pg = extractJsonLd(html)
    if (!pg) return { kind: "parse-fail" }
    // Available if any variant is InStock; out otherwise.
    const anyInStock = pg.hasVariant.some(
      (v) => v.offers.availability === "https://schema.org/InStock",
    )
    return anyInStock ? { kind: "in-stock" } : { kind: "out-of-stock" }
  } finally {
    clearTimeout(timeout)
  }
}
```

The surrounding job logic (iterating products, updating status, sending Telegram alerts, circuit-break threshold) stays exactly as written in original Task 20.

**One additional behavior:** check each variant's `metadata.shein_url` (the per-color sibling URL we stored in revised Task 2), NOT just the product-level `metadata.shein_url`. A multi-color preorder may have Color A sold out on SHEIN but Color B still in stock — only mark the WHOLE product to draft when ALL variants' SHEIN URLs are unavailable. Concrete logic:

```typescript
// In the main loop, instead of one fetch per product, gather variant urls:
const variantUrls = (p as any).variants?.map(
  (v: any) => v.metadata?.shein_url
).filter(Boolean) ?? []
const distinctUrls = Array.from(new Set([p.metadata?.shein_url, ...variantUrls]
  .filter((u): u is string => typeof u === "string")))

const results = await Promise.all(distinctUrls.map(checkSheinUrl))
const allOut = results.length > 0 && results.every(
  (r) => r.kind === "out-of-stock" || r.kind === "removed",
)
const anyBlocked = results.some((r) => r.kind === "blocked")
// then branch on allOut / anyBlocked as in v1
```

This requires fetching `variants.metadata` in the initial `query.graph` call — add `variants.id`, `variants.metadata` to the fields list.

---

## Summary of what's NOT changing

These original tasks are unchanged:

- **Task 3** — Refactor existing POST. The shared helper signature is the same shape (`CreatePreorderProductInput`), so the refactor logic is identical, just the input shape passed in differs.
- **Tasks 4-7** — Storefront PDP, gallery, color swatches. The DUB-front side reads `variant.metadata.image_urls` regardless of whether that came from the admin form or the bookmarklet. Same code path.
- **Task 8** — Phase 1 smoke. Unchanged.
- **Tasks 9-11** — Token model, service, admin token route. No SHEIN logic involved.
- **Task 13** — Backend smoke. Just update the curl example body to the multi-color shape.
- **Task 14** — CORS. Unchanged.
- **Task 16** — `build-bookmarklet.ts` helper. Unchanged.
- **Task 17** — Admin settings page UI. Unchanged.
- **Task 18** — Phase 2 smoke. Unchanged (just expect multi-color in output).
- **Task 19** — Telegram message templates. Unchanged.
- **Task 21** — Manual one-shot script. Unchanged.
- **Task 22** — Phase 3 smoke. Unchanged.

---

## Resumption order

When subagent execution resumes, dispatch tasks in this order:

1. **Task 1 (revised)** ← Start here
2. Task 2 (revised)
3. Task 3
4. Task 4
5. Task 5
6. Task 6
7. Task 7
8. Task 8 (manual — owner does after phase 1 deploy)
9. Task 9
10. Task 10
11. Task 11
12. Task 12 (revised body shape)
13. Task 13 (manual)
14. Task 14 (manual)
15. Task 15 (revised)
16. Task 16
17. Task 17
18. Task 18 (manual)
19. Task 19
20. Task 20 (revised)
21. Task 21
22. Task 22 (manual)

