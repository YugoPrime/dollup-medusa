import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { muDay } from "../../lib/daily-sales-report"
import {
  computeStockValue,
  pickSourcingCosts,
  toSnapProducts,
  type RawProduct,
  type RawSourcingItem,
} from "../../lib/stock-snapshot"
import { SOURCING_MODULE } from "../sourcing"
import { SOURCING_SETTINGS_MODULE } from "../sourcing-settings"
import { STOCK_SNAPSHOTS_MODULE } from "."
import type StockSnapshotsModuleService from "./service"
import type { StockSnapshotRow } from "./service"

type Scope = { resolve(key: string): any }

const PAGE = 100

const PRODUCT_FIELDS = [
  "id",
  "variants.id",
  "variants.manage_inventory",
  "variants.metadata",
  "variants.prices.amount",
  "variants.prices.currency_code",
  "variants.prices.price_list_id",
  "variants.prices.rules_count",
  "variants.inventory_items.inventory.location_levels.stocked_quantity",
  "variants.inventory_items.inventory.location_levels.reserved_quantity",
]

/** Every product (all statuses), a page at a time so no single query gets huge. */
async function loadProducts(scope: Scope): Promise<RawProduct[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const out: RawProduct[] = []
  for (let skip = 0; ; skip += PAGE) {
    const { data, metadata } = await query.graph({
      entity: "product",
      fields: PRODUCT_FIELDS,
      pagination: { skip, take: PAGE, order: { id: "ASC" } },
    })
    out.push(...((data ?? []) as RawProduct[]))
    const count = Number(metadata?.count ?? 0)
    if ((data ?? []).length < PAGE || skip + PAGE >= count) break
  }
  return out
}

/**
 * Values today's stock with the Restock report's rules and writes it as the
 * day's snapshot (Mauritius day of `now`), replacing an earlier run that day.
 */
export async function takeStockSnapshot(
  scope: Scope,
  now: Date = new Date(),
): Promise<StockSnapshotRow> {
  const sourcing = scope.resolve(SOURCING_MODULE)
  const settings = scope.resolve(SOURCING_SETTINGS_MODULE)

  const [products, items, { fx_rate }] = await Promise.all([
    loadProducts(scope),
    sourcing.listDraftItems(
      { published_product_id: { $ne: null } },
      { relations: ["draft_order"], take: null },
    ) as Promise<RawSourcingItem[]>,
    settings.getSettings() as Promise<{ fx_rate: number }>,
  ])

  const value = computeStockValue(
    toSnapProducts(products),
    pickSourcingCosts(items, Number(fx_rate)),
  )
  const snapshots = scope.resolve(STOCK_SNAPSHOTS_MODULE) as StockSnapshotsModuleService
  return snapshots.upsertDay(muDay(now), value)
}
