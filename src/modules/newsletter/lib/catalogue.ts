import { computeInventoryQuantity } from "../../stories/product-source"
import type { NewsletterList } from "../types"

export const ADULT_CATEGORY_HANDLES = ["intimates", "toys"] as const
export const MAX_PRODUCTS = 24

export type CatalogueProduct = {
  id: string
  title: string
  handle: string
  status: string
  thumbnail: string | null
  images?: { url: string }[] | null
  categories?: { handle?: string | null }[] | null
  metadata?: Record<string, unknown> | null
  variants?: Array<{
    manage_inventory?: boolean | null
    inventory_items?: unknown[]
    calculated_price?: {
      calculated_amount?: number | null
      original_amount?: number | null
    } | null
  }> | null
}

export type DropReason =
  | "not_found"
  | "unpublished"
  | "out_of_stock"
  | "adult_on_main"
  | "unlisted"
  | "no_price"

export type CatalogueCard = {
  id: string
  title: string
  url: string
  imageUrl: string | null
  price: string
  originalPrice: string | null
}

export type PickerRow = {
  id: string
  title: string
  handle: string
  imageUrl: string | null
  price: string | null
  originalPrice: string | null
  inStock: boolean
  adult: boolean
}

export function isAdultProduct(
  p: Pick<CatalogueProduct, "categories" | "metadata">,
): boolean {
  const adultHandles: readonly string[] = ADULT_CATEGORY_HANDLES
  const inAdultCategory = (p.categories ?? []).some((c) =>
    adultHandles.includes((c?.handle ?? "").toLowerCase()),
  )
  return inAdultCategory || p.metadata?.age_restricted === true
}

export function isUnlistedProduct(p: Pick<CatalogueProduct, "metadata">): boolean {
  return p.metadata?.unlisted === true
}

const MAIL_SAFE_IMAGE = /\.(jpe?g|png)$/i

function urlPath(url: string): string {
  return url.split("#")[0].split("?")[0]
}

/**
 * First JPEG/PNG among thumbnail + images (WebP is poorly supported in mail
 * clients). Falls back to the first non-empty URL, which may be WebP.
 */
export function pickEmailImage(
  p: Pick<CatalogueProduct, "thumbnail" | "images">,
): string | null {
  const urls = [p.thumbnail, ...(p.images ?? []).map((i) => i?.url)].filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  )
  return urls.find((u) => MAIL_SAFE_IMAGE.test(urlPath(u))) ?? urls[0] ?? null
}

const MUR = new Intl.NumberFormat("en-MU", {
  style: "currency",
  currency: "MUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function formatMur(amount: number): string {
  // Some ICU builds put a non-breaking space between "Rs" and the number.
  return MUR.format(amount).replace(/[\u00A0\u202F]/g, " ")
}

export function productUrl(
  storefrontUrl: string,
  handle: string,
  campaignId: string,
): string {
  const base = storefrontUrl.replace(/\/+$/, "")
  return `${base}/products/${handle}?utm_source=newsletter&utm_medium=email&utm_campaign=${campaignId}`
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function inStockVariants(p: CatalogueProduct) {
  return (p.variants ?? []).filter((v) => computeInventoryQuantity(v) > 0)
}

/** Price of the cheapest in-stock variant that has a numeric price. */
function cheapestPrice(
  p: CatalogueProduct,
): { price: number; original: number | null } | null {
  let best: { price: number; original: number | null } | null = null
  for (const v of inStockVariants(p)) {
    const price = num(v.calculated_price?.calculated_amount)
    if (price === null) continue
    if (best === null || price < best.price) {
      const original = num(v.calculated_price?.original_amount)
      best = { price, original: original !== null && original > price ? original : null }
    }
  }
  return best
}

export function buildCatalogueCards(
  products: CatalogueProduct[],
  orderedIds: string[],
  opts: { list: NewsletterList; storefrontUrl: string; campaignId: string },
): {
  cards: CatalogueCard[]
  dropped: Array<{ id: string; title: string | null; reason: DropReason }>
} {
  const byId = new Map(products.map((p) => [p.id, p]))
  const cards: CatalogueCard[] = []
  const dropped: Array<{ id: string; title: string | null; reason: DropReason }> = []

  for (const id of orderedIds) {
    const p = byId.get(id)
    const drop = (reason: DropReason) =>
      dropped.push({ id, title: p?.title ?? null, reason })

    if (!p) drop("not_found")
    else if (p.status !== "published") drop("unpublished")
    else if (isUnlistedProduct(p)) drop("unlisted")
    else if (opts.list === "main" && isAdultProduct(p)) drop("adult_on_main")
    else if (inStockVariants(p).length === 0) drop("out_of_stock")
    else {
      const price = cheapestPrice(p)
      if (!price) drop("no_price")
      else if (cards.length < MAX_PRODUCTS) {
        cards.push({
          id: p.id,
          title: p.title,
          url: productUrl(opts.storefrontUrl, p.handle, opts.campaignId),
          imageUrl: pickEmailImage(p),
          price: formatMur(price.price),
          originalPrice: price.original !== null ? formatMur(price.original) : null,
        })
      }
    }
  }
  return { cards, dropped }
}

export function toPickerRow(p: CatalogueProduct): PickerRow {
  const price = cheapestPrice(p)
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    imageUrl: pickEmailImage(p),
    price: price ? formatMur(price.price) : null,
    originalPrice: price?.original != null ? formatMur(price.original) : null,
    inStock: inStockVariants(p).length > 0,
    adult: isAdultProduct(p),
  }
}
