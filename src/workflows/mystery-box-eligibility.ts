import { moneyNumber } from "./apply-mystery-box-discount"

// What may go in a Mystery Box: the server-side gate behind
// POST /store/mystery-box/create-cart. The storefront builds its pool with
// the same rules (DUB-front src/lib/mystery-box.ts): keep the lists equal.
// Owner, 25 Nov 2026: no Ali30 pieces, no toys, and the box is off while a
// sale runs, because sale prices make 5 pieces worth less than the box.

/** collection30 = the Ali30 new arrivals, sold at full price. */
export const MYSTERY_BOX_EXCLUDED_TAGS = ["collection30"]
/** intimates + toys = After Dark. */
export const MYSTERY_BOX_EXCLUDED_CATEGORY_HANDLES = ["intimates", "toys"]

export type MysteryBoxExclusion =
  | "not_discountable"
  | "unlisted"
  | "excluded_tag"
  | "excluded_category"

type ProductForEligibility = {
  discountable?: boolean | null
  metadata?: Record<string, unknown> | null
  tags?: Array<{ value?: string | null } | null> | null
  categories?: Array<{ handle?: string | null } | null> | null
}

/** Why a product can't go in a box, or null when it can. */
export function mysteryBoxExclusion(
  product: ProductForEligibility,
): MysteryBoxExclusion | null {
  if (product.discountable === false) return "not_discountable"
  if (product.metadata?.unlisted === true) return "unlisted"
  const tags = (product.tags ?? []).map((t) =>
    (t?.value ?? "").trim().toLowerCase(),
  )
  if (tags.some((t) => MYSTERY_BOX_EXCLUDED_TAGS.includes(t))) {
    return "excluded_tag"
  }
  const handles = (product.categories ?? []).map((c) =>
    (c?.handle ?? "").toLowerCase(),
  )
  if (handles.some((h) => MYSTERY_BOX_EXCLUDED_CATEGORY_HANDLES.includes(h))) {
    return "excluded_category"
  }
  return null
}

type Money = number | string | { value?: string | number } | null | undefined

/**
 * True when a cart line is priced from a sale price list. Medusa stamps
 * compare_at_unit_price with the original price on those lines
 * (core-flows prepareLineItemData), so this needs no sale dates.
 */
export function isSalePricedLine(item: {
  unit_price?: Money
  compare_at_unit_price?: Money
}): boolean {
  if (item.compare_at_unit_price == null) return false
  const compareAt = moneyNumber(item.compare_at_unit_price)
  const unit = moneyNumber(item.unit_price)
  return Number.isFinite(compareAt) && Number.isFinite(unit) && compareAt > unit
}
