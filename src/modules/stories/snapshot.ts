export type ProductVariantLike = {
  id: string
  sku?: string | null
  title?: string | null
  inventory_quantity: number
  prices: Array<{ amount: number; currency_code: string }>
  /** Minor units (cents). Set when a Price List discount is active so the
   *  picker can detect "on sale" — should be > prices[].amount in same
   *  currency. Leave null/undefined when there is no sale. */
  compare_at_amount?: number | null
  options: Record<string, string | null | undefined>
  images?: Array<{ url: string }>
}

export type ProductLike = {
  id: string
  title: string
  handle: string
  /** ISO date string or Date. Used to derive ProductSnapshot.is_new_arrival.
   *  Optional so existing tests/callers don't break — when absent the snapshot
   *  treats the product as "not new". */
  created_at?: string | Date
  variants: ProductVariantLike[]
}

export type SnapshotVariant = {
  id: string
  sku: string | null
  color: string | null
  color_code: string | null
  sizes: string[]
  image_urls: string[]
}

export type ProductSnapshot = {
  name: string
  handle: string
  price_mur: number
  compare_at_price_mur: number | null
  variants_in_stock: SnapshotVariant[]
  variant_in_stock_count: number
  /** True when product.created_at is within NEW_ARRIVAL_WINDOW_DAYS of the
   *  pick time. Picker uses this to pick the "new-arrival" template rather
   *  than false-firing the NEW ARRIVAL badge on older products. */
  is_new_arrival: boolean
  picked_at: string
}

const NEW_ARRIVAL_WINDOW_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Pure function. Given a Medusa product, returns the slot snapshot:
 *   - filters to in-stock variants only (inventory_quantity > 0)
 *   - groups variants by color
 *   - per color: collects in-stock sizes and concatenates that color's images
 *   - prices from the first MUR price; converted from cents to MUR
 *
 * Why grouping by color and not by variant: the planner needs ONE row per
 * color (with its images) so the slot card lays out "Color: Pink — [front,
 * back]" then "Color: Blue — [front]". The user picks which to post.
 */
export function buildSnapshot(product: ProductLike): ProductSnapshot {
  const inStock = product.variants.filter((v) => v.inventory_quantity > 0)

  const byColor = new Map<string, SnapshotVariant>()
  for (const v of inStock) {
    const color = (v.options?.color as string) ?? null
    const colorCode = (v.options?.color_code as string) ?? null
    const size = (v.options?.size as string) ?? ""
    const key = color ?? `__solo_${v.id}`
    if (!byColor.has(key)) {
      byColor.set(key, {
        id: v.id,
        sku: v.sku ?? null,
        color,
        color_code: colorCode,
        sizes: [],
        image_urls: [],
      })
    }
    const entry = byColor.get(key)!
    if (size && !entry.sizes.includes(size)) entry.sizes.push(size)
    for (const img of v.images ?? []) {
      if (!entry.image_urls.includes(img.url)) entry.image_urls.push(img.url)
    }
  }

  const variantsInStock = Array.from(byColor.values())

  const firstMurPrice = inStock[0]?.prices.find((p) => p.currency_code === "mur")
  const priceMur = firstMurPrice ? Math.round(firstMurPrice.amount / 100) : 0

  // compare_at is only meaningful when it's strictly greater than the active
  // price — otherwise it would falsely trigger the on-sale template branch.
  const compareAtAmount = inStock[0]?.compare_at_amount
  const compareAtMur =
    compareAtAmount != null && Number.isFinite(compareAtAmount)
      ? Math.round(compareAtAmount / 100)
      : null
  const compareAtPriceMur =
    compareAtMur != null && compareAtMur > priceMur ? compareAtMur : null

  const now = Date.now()
  const createdAt =
    product.created_at != null ? new Date(product.created_at).getTime() : NaN
  const isNewArrival =
    Number.isFinite(createdAt) && now - createdAt <= NEW_ARRIVAL_WINDOW_DAYS * DAY_MS

  return {
    name: product.title,
    handle: product.handle,
    price_mur: priceMur,
    compare_at_price_mur: compareAtPriceMur,
    variants_in_stock: variantsInStock,
    variant_in_stock_count: variantsInStock.length,
    is_new_arrival: isNewArrival,
    picked_at: new Date(now).toISOString(),
  }
}
