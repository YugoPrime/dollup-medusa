export type ProductVariantLike = {
  id: string
  sku?: string | null
  title?: string | null
  inventory_quantity: number
  prices: Array<{ amount: number; currency_code: string }>
  options: Record<string, string | null | undefined>
  images?: Array<{ url: string }>
}

export type ProductLike = {
  id: string
  title: string
  handle: string
  variants: ProductVariantLike[]
}

export type SnapshotVariant = {
  id: string
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
  picked_at: string
}

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

  return {
    name: product.title,
    handle: product.handle,
    price_mur: priceMur,
    compare_at_price_mur: null,
    variants_in_stock: variantsInStock,
    variant_in_stock_count: variantsInStock.length,
    picked_at: new Date().toISOString(),
  }
}
