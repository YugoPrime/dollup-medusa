import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  QueryContext,
} from "@medusajs/framework/utils"

import { STORIES_MODULE } from "../../../../../modules/stories"
import type StoriesModuleService from "../../../../../modules/stories/service"
import type { ProductLike } from "../../../../../modules/stories/snapshot"
import {
  isIntimatesProduct,
  toProductLike,
} from "../../../../../modules/stories/product-source"

/**
 * Batch-create N daily plans with shared anti-repeat. Reuses the same
 * query.graph wiring as regenerate/route.ts so single-day and batch produce
 * identical inventory + price computations.
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const stories = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const body = (req.body ?? {}) as Record<string, unknown>
  const start_date = String(body.start_date ?? "")
  const days = Number(body.days ?? 1)
  const category_distribution = Array.isArray(body.category_distribution)
    ? (body.category_distribution as Array<{ category_id: string; count: number }>)
    : []
  const scheduled_times = Array.isArray(body.scheduled_times)
    ? (body.scheduled_times as string[])
    : []
  const notes = typeof body.notes === "string" ? body.notes : null

  const productSource = async (filter: { category_id?: string }): Promise<ProductLike[]> => {
    const filters: Record<string, unknown> = { status: "published" }
    if (filter.category_id) filters.categories = { id: filter.category_id }
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
        variants: { calculated_price: QueryContext({ currency_code: "mur" }) },
      },
    })
    return products.filter((p: any) => !isIntimatesProduct(p)).map(toProductLike)
  }

  try {
    const plans = await stories.createBatchPlans(
      { start_date, days, category_distribution, scheduled_times, notes },
      { productSource },
    )
    res.status(201).json({ plans })
  } catch (err) {
    const msg = (err as Error)?.message ?? "Batch create failed"
    const status = /already exist/i.test(msg) ? 409 : 400
    res.status(status).json({ message: msg })
  }
}

