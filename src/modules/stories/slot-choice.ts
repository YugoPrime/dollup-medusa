import { pickWithFocus, type WeightingConfig } from "./picker-weighting"
import type { ProductLike } from "./snapshot"

/**
 * Chooses the product for one story slot: the slot's own category first,
 * then every category (the fallback). A product is eligible when it has stock
 * and is in neither `excluded` (anti-repeat + already used in this batch) nor
 * `gridExcluded` (that day's grid post). Within each pool the new-collection
 * focus comes first (see pickWithFocus).
 */
export async function chooseSlotProduct(args: {
  inCategory: ProductLike[]
  union: () => Promise<ProductLike[]>
  excluded: Set<string>
  gridExcluded: Set<string>
  focusTag: string | null
  weighting: WeightingConfig
  now: number
  rng?: () => number
}): Promise<{ product: ProductLike | null; fallbackUsed: boolean }> {
  const eligible = (p: ProductLike) =>
    p.variants.some((v) => v.inventory_quantity > 0) &&
    !args.excluded.has(p.id) &&
    !args.gridExcluded.has(p.id)
  const pick = (arr: ProductLike[]) =>
    pickWithFocus(arr.filter(eligible), args.focusTag, args.weighting, args.now, args.rng)

  const own = pick(args.inCategory)
  if (own) return { product: own, fallbackUsed: false }

  const fallback = pick(await args.union())
  return { product: fallback, fallbackUsed: fallback != null }
}
