import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  QueryContext,
} from "@medusajs/framework/utils"

import { STORIES_MODULE } from "../../../../../../modules/stories"
import { toProductLike } from "../../../../../../modules/stories/product-source"
import type StoriesModuleService from "../../../../../../modules/stories/service"

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
