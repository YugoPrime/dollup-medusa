import { ContainerRegistrationKeys, QueryContext } from "@medusajs/framework/utils"

import type { ProductLike } from "./snapshot"

/**
 * Wires the stories picker to Medusa's product module via query.graph so the
 * pricing module's calculated_price + original_amount (a remote link) and the
 * inventory levels are traversed in one call.
 *
 * Returns a `productSource(filter)` function with the same signature
 * StoriesModuleService.regeneratePlan / createBatchPlans expect. Filters by
 * status=published and an optional `category_id`. Skips Intimates products
 * (18+, marked unlisted) so the auto-planner never picks them.
 */
export function createMedusaProductSource(scope: {
  resolve(key: any): any
}): (filter: { category_id?: string }) => Promise<ProductLike[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  return async (filter) => {
    const filters: Record<string, unknown> = { status: "published" }
    if (filter.category_id) {
      filters.categories = { id: filter.category_id }
    }
    const { data: products } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "title",
        "handle",
        "created_at",
        "metadata",
        "images.url",
        "categories.handle",
        "variants.id",
        "variants.sku",
        "variants.title",
        "variants.manage_inventory",
        "variants.inventory_items.required_quantity",
        "variants.inventory_items.inventory.location_levels.stocked_quantity",
        "variants.inventory_items.inventory.location_levels.reserved_quantity",
        "variants.options.value",
        "variants.options.option.title",
        "variants.calculated_price.*",
      ],
      filters,
      pagination: { take: 500 },
      context: {
        variants: {
          calculated_price: QueryContext({ currency_code: "mur" }),
        },
      },
    })
    return (products as any[]).filter((p) => !isIntimatesProduct(p)).map(toProductLike)
  }
}

/**
 * Medusa v2 has no `inventory_quantity` on product_variant — stock lives in
 * the Inventory module, joined via inventory_items.inventory.location_levels.
 * Sum (stocked - reserved) across every level of every linked item; if the
 * variant is not inventory-managed, treat as effectively unlimited.
 */
export function computeInventoryQuantity(v: any): number {
  if (v.manage_inventory === false) return Number.MAX_SAFE_INTEGER
  let total = 0
  for (const ii of v.inventory_items ?? []) {
    for (const lvl of ii.inventory?.location_levels ?? []) {
      total += Number(lvl.stocked_quantity ?? 0) - Number(lvl.reserved_quantity ?? 0)
    }
  }
  return Math.max(0, total)
}

/**
 * A product is "Intimates" if any of its categories has the `intimates`
 * handle, OR if metadata.unlisted is true (treated as adult-tier).
 */
export function isIntimatesProduct(p: any): boolean {
  const cats: Array<{ handle?: string }> = p.categories ?? []
  if (cats.some((c) => (c?.handle ?? "").toLowerCase() === "intimates")) return true
  const meta = (p.metadata ?? null) as Record<string, unknown> | null
  if (meta && meta.unlisted === true) return true
  return false
}

export function toProductLike(p: any): ProductLike {
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    created_at: p.created_at,
    variants: (p.variants ?? []).map((v: any) => {
      const calc = v.calculated_price
      const displayAmount = calc?.calculated_amount
      const amount = displayAmount != null ? Number(displayAmount) * 100 : null
      const prices =
        amount != null && Number.isFinite(amount)
          ? [{ amount, currency_code: String(calc?.currency_code ?? "mur") }]
          : []
      const originalDisplay = calc?.original_amount
      const compareAtAmount =
        originalDisplay != null ? Number(originalDisplay) * 100 : null
      return {
        id: v.id,
        sku: v.sku,
        title: v.title,
        inventory_quantity: computeInventoryQuantity(v),
        prices,
        compare_at_amount:
          compareAtAmount != null && Number.isFinite(compareAtAmount)
            ? compareAtAmount
            : null,
        options: Object.fromEntries(
          (v.options ?? []).map((o: any) => [
            o.option?.title?.toLowerCase() ?? "opt",
            o.value,
          ]),
        ),
        images: (p.images ?? []).map((img: any) => ({ url: img.url })),
      }
    }),
  }
}
