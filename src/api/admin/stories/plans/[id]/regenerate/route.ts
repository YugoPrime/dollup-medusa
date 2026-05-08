import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  QueryContext,
} from "@medusajs/framework/utils"

import { STORIES_MODULE } from "../../../../../../modules/stories"
import type StoriesModuleService from "../../../../../../modules/stories/service"
import type { ProductLike } from "../../../../../../modules/stories/snapshot"

/**
 * Wires the stories picker to the Medusa product module via query.graph so the
 * pricing module's calculated_price (a remote link) can be traversed in one call.
 * Returns rich Product entities shaped into ProductLike for the picker.
 *
 * `category_id` filter uses Medusa's product.categories relation.
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const planId = req.params.id
  const stories = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const productSource = async (filter: { category_id?: string }): Promise<ProductLike[]> => {
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
        "images.url",
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
    return products.map(toProductLike)
  }

  try {
    await stories.regeneratePlan(planId, { productSource })
    const slots = (await stories.listStorySlots({ plan_id: planId }))
      .sort((a, b) => a.slot_index - b.slot_index)
    res.json({ slots })
  } catch (err) {
    const msg = (err as Error)?.message ?? "Regenerate failed"
    const status = /completed/i.test(msg) ? 409 : 400
    res.status(status).json({ message: msg })
  }
}

// Medusa v2 has no `inventory_quantity` on product_variant — stock lives in the
// Inventory module, joined via inventory_items.inventory.location_levels. Sum
// (stocked - reserved) across every level of every linked item; if the variant
// is not inventory-managed, treat as effectively unlimited.
function computeInventoryQuantity(v: any): number {
  if (v.manage_inventory === false) return Number.MAX_SAFE_INTEGER
  let total = 0
  for (const ii of v.inventory_items ?? []) {
    for (const lvl of ii.inventory?.location_levels ?? []) {
      total += Number(lvl.stocked_quantity ?? 0) - Number(lvl.reserved_quantity ?? 0)
    }
  }
  return Math.max(0, total)
}

function toProductLike(p: any): ProductLike {
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    variants: (p.variants ?? []).map((v: any) => {
      const calc = v.calculated_price
      // raw_calculated_amount.value is the minor-unit integer string (e.g. "129000"
      // for Rs 1290), matching what snapshot.ts expects (it divides amount by 100).
      // calculated_amount is the display number (1290) — fall back × 100 if raw missing.
      const rawValue = calc?.raw_calculated_amount?.value
      const displayAmount = calc?.calculated_amount
      let amount: number | null = null
      if (rawValue != null) amount = Number(rawValue)
      else if (displayAmount != null) amount = Number(displayAmount) * 100
      const prices =
        amount != null && Number.isFinite(amount)
          ? [{ amount, currency_code: String(calc?.currency_code ?? "mur") }]
          : []
      return {
        id: v.id,
        sku: v.sku,
        title: v.title,
        inventory_quantity: computeInventoryQuantity(v),
        prices,
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
