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
