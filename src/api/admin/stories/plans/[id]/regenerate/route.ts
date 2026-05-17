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
    // Story planner must never auto-pick Intimates products (18+, partly private).
    return products.filter((p: any) => !isIntimatesProduct(p)).map(toProductLike)
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

// A product is "Intimates" if any of its categories has the `intimates`
// handle, OR if metadata.unlisted is true (also treated as adult-tier).
function isIntimatesProduct(p: any): boolean {
  const cats: Array<{ handle?: string }> = p.categories ?? []
  if (cats.some((c) => (c?.handle ?? "").toLowerCase() === "intimates")) return true
  const meta = (p.metadata ?? null) as Record<string, unknown> | null
  if (meta && meta.unlisted === true) return true
  return false
}

function toProductLike(p: any): ProductLike {
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
      // Price-List discounts surface as a higher original_amount than
      // calculated_amount — pass through so the snapshot/picker can detect sale.
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
