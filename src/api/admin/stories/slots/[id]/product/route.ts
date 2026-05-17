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
 * Manually swap the product picked for a slot. Rejects posted slots.
 * Body: { product_id: string }
 */
export const PUT = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const id = req.params.id
  const body = (req.body ?? {}) as Record<string, unknown>
  const productId = typeof body.product_id === "string" ? body.product_id : null
  if (!productId) {
    res.status(400).json({ message: "product_id (string) is required" })
    return
  }

  const stories = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "handle",
      "created_at",
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
    filters: { id: productId },
    pagination: { take: 1 },
    context: {
      variants: { calculated_price: QueryContext({ currency_code: "mur" }) },
    },
  })
  const p = (products as any[])[0]
  if (!p) {
    res.status(404).json({ message: `Product ${productId} not found` })
    return
  }

  const productLike = toProductLike(p)
  try {
    await stories.swapSlotProduct(id, productLike)
    const [slot] = await stories.listStorySlots({ id })
    res.json({ slot })
  } catch (err) {
    const msg = (err as Error)?.message ?? "Swap failed"
    const status = /posted/i.test(msg) ? 409 : /not found/i.test(msg) ? 404 : 400
    res.status(status).json({ message: msg })
  }
}

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
