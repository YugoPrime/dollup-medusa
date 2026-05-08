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
        variants: { calculated_price: QueryContext({ currency_code: "mur" }) },
      },
    })
    return products.map(toProductLike)
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
      const displayAmount = calc?.calculated_amount
      const amount = displayAmount != null ? Number(displayAmount) * 100 : null
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
