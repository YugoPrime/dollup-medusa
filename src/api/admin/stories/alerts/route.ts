import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { STORIES_MODULE } from "../../../../modules/stories"
import type StoriesModuleService from "../../../../modules/stories/service"

/**
 * Returns "at-risk" slots (unposted, in next ~7 days, picked product has total
 * available stock ≤ settings.stock_alert_threshold).
 *
 * Stock is computed by summing stocked - reserved across each variant's
 * inventory items + location levels, mirroring the picker's eligibility check.
 * `manage_inventory: false` variants are treated as effectively unlimited.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const stories = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const variantStockLookup = async (productIds: string[]): Promise<Map<string, number>> => {
    if (productIds.length === 0) return new Map()
    const { data: products } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "variants.manage_inventory",
        "variants.inventory_items.inventory.location_levels.stocked_quantity",
        "variants.inventory_items.inventory.location_levels.reserved_quantity",
      ],
      filters: { id: productIds },
      pagination: { take: productIds.length },
    })
    const out = new Map<string, number>()
    for (const p of products as Array<{ id: string; variants?: any[] }>) {
      let total = 0
      for (const v of p.variants ?? []) {
        if (v.manage_inventory === false) {
          out.set(p.id, Number.MAX_SAFE_INTEGER)
          total = Number.MAX_SAFE_INTEGER
          break
        }
        for (const ii of v.inventory_items ?? []) {
          for (const lvl of ii.inventory?.location_levels ?? []) {
            total += Number(lvl.stocked_quantity ?? 0) - Number(lvl.reserved_quantity ?? 0)
          }
        }
      }
      if (!out.has(p.id)) out.set(p.id, Math.max(0, total))
    }
    for (const id of productIds) if (!out.has(id)) out.set(id, 0)
    return out
  }

  try {
    const alerts = await stories.getStockAlerts({ variantStockLookup })
    res.json({ alerts })
  } catch (err) {
    res.status(200).json({ alerts: [], error: (err as Error)?.message ?? "alerts failed" })
  }
}
