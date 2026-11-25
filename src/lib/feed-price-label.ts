/**
 * Price and product code for the daily grid post photos.
 *
 * Customers screenshot a grid photo and send it in a DM, so every photo carries
 * what they need to order: the product code (top right) and the price (above
 * the sizes). Rahvi, 2026-11-25.
 */

export type FeedPriceLabel = {
  /** What the customer pays now, in whole rupees. */
  price_mur: number
  /** True when the sizes on this photo don't all cost the same: "From Rs X". */
  from: boolean
  /** The pre-sale price, struck through; only when on sale and not `from`. */
  was_mur: number | null
}

type SnapshotLike = {
  handle?: string | null
  price_mur?: number | null
  compare_at_price_mur?: number | null
  variants_in_stock?: Array<{
    sku?: string | null
    image_urls?: string[] | null
    price_mur?: number | null
    price_max_mur?: number | null
    compare_at_price_mur?: number | null
  }> | null
} | null | undefined

const MUR = new Intl.NumberFormat("en-US", { useGrouping: true })

/** "Rs 1,250" */
export function formatRs(amount: number): string {
  return `Rs ${MUR.format(amount)}`
}

function positive(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/**
 * The price to print on one photo: the colours whose photos include it (all
 * colours when none claims it), the same rule as the sizes. Snapshots saved
 * before colours carried a price use the product's price. Null = no price.
 */
export function priceForPhoto(snapshot: SnapshotLike, url: string): FeedPriceLabel | null {
  const variants = snapshot?.variants_in_stock ?? []
  const claimed = variants.filter((v) => (v.image_urls ?? []).includes(url))
  const pool = (claimed.length > 0 ? claimed : variants).filter((v) => positive(v.price_mur) != null)

  if (pool.length === 0) {
    const price = positive(snapshot?.price_mur)
    if (price == null) return null
    const was = positive(snapshot?.compare_at_price_mur)
    return { price_mur: price, from: false, was_mur: was != null && was > price ? was : null }
  }

  let low = pool[0]
  let high = positive(pool[0].price_max_mur) ?? positive(pool[0].price_mur)!
  for (const v of pool) {
    if (positive(v.price_mur)! < positive(low.price_mur)!) low = v
    high = Math.max(high, positive(v.price_max_mur) ?? positive(v.price_mur)!)
  }
  const price = positive(low.price_mur)!
  const from = high > price
  const was = positive(low.compare_at_price_mur)
  return { price_mur: price, from, was_mur: !from && was != null && was > price ? was : null }
}

/** IS2462, TS13 …: letters then digits, the code the shop and the catalogues show. */
const CODE_RE = /^[a-z]{1,4}\d{2,6}[a-z]?$/i

/**
 * The product code for the top-right pill: the handle when it is the code
 * (is2462 → IS2462), else the stem of a variant SKU (IS2328-PINK-S → IS2328).
 * Null when neither looks like a code, so no pill is drawn.
 */
export function productCode(snapshot: SnapshotLike): string | null {
  const handle = String(snapshot?.handle ?? "").trim()
  if (CODE_RE.test(handle)) return handle.toUpperCase()
  for (const v of snapshot?.variants_in_stock ?? []) {
    const stem = String(v.sku ?? "").trim().split("-")[0]
    if (CODE_RE.test(stem)) return stem.toUpperCase()
  }
  return null
}
