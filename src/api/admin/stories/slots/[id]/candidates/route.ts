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

/**
 * Returns swap candidates for a slot: in-stock published products in the
 * slot's category (or all categories with ?all=1). Excludes the currently
 * picked product. Marks products picked recently (within
 * settings.anti_repeat_days) so the UI can show a soft warning.
 *
 * Response: { candidates: Array<Candidate> }
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const id = req.params.id
  const showAll = String((req.query as Record<string, unknown>).all ?? "") === "1"

  const stories = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const [slot] = await stories.listStorySlots({ id })
  if (!slot) {
    res.status(404).json({ message: "Slot not found" })
    return
  }

  const settings = await stories.getSettings()
  const excluded = new Set(await stories.getExcludedProductIds(settings.anti_repeat_days))

  const filters: Record<string, unknown> = { status: "published" }
  if (!showAll && slot.category_id) {
    filters.categories = { id: slot.category_id }
  }

  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "handle",
      "thumbnail",
      "images.url",
      "variants.id",
      "variants.manage_inventory",
      "variants.inventory_items.inventory.location_levels.stocked_quantity",
      "variants.inventory_items.inventory.location_levels.reserved_quantity",
      "variants.calculated_price.*",
    ],
    filters,
    pagination: { take: 200 },
    context: {
      variants: { calculated_price: QueryContext({ currency_code: "mur" }) },
    },
  })

  type Candidate = {
    id: string
    title: string
    handle: string
    thumbnail_url: string | null
    price_mur: number | null
    in_stock_total: number
    recently_picked: boolean
  }

  const candidates: Candidate[] = []
  for (const p of products as any[]) {
    if (p.id === slot.product_id) continue  // skip currently-picked

    let inStock = 0
    let anyUnlimited = false
    for (const v of p.variants ?? []) {
      if (v.manage_inventory === false) {
        anyUnlimited = true
        continue
      }
      let total = 0
      for (const ii of v.inventory_items ?? []) {
        for (const lvl of ii.inventory?.location_levels ?? []) {
          total += Number(lvl.stocked_quantity ?? 0) - Number(lvl.reserved_quantity ?? 0)
        }
      }
      inStock += Math.max(0, total)
    }
    if (!anyUnlimited && inStock <= 0) continue  // out of stock

    const calc = (p.variants?.[0]?.calculated_price ?? null) as
      | { calculated_amount?: number | string }
      | null
    const priceMur =
      calc?.calculated_amount != null ? Number(calc.calculated_amount) : null

    const thumbnail =
      (typeof p.thumbnail === "string" && p.thumbnail) ||
      (p.images?.[0]?.url ?? null)

    candidates.push({
      id: p.id,
      title: p.title,
      handle: p.handle,
      thumbnail_url: thumbnail,
      price_mur: priceMur,
      in_stock_total: anyUnlimited ? Number.MAX_SAFE_INTEGER : inStock,
      recently_picked: excluded.has(p.id),
    })
  }

  // Sort: not-recently-picked first, then by title
  candidates.sort((a, b) => {
    if (a.recently_picked !== b.recently_picked) return a.recently_picked ? 1 : -1
    return a.title.localeCompare(b.title)
  })

  res.json({ candidates })
}
