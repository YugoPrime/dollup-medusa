/**
 * Stock value maths for the nightly snapshot (src/jobs/stock-value-snapshot.ts).
 * Pure, so it is unit-tested; src/modules/stock-snapshots/take-snapshot.ts
 * feeds it live data.
 *
 * Keep in sync with dollup-admin/src/lib/restock-report-core.ts: the chart of
 * these snapshots sits under the report's "Stock value at cost" tile, and the
 * two must agree on the same day.
 */
import { muDay } from "./daily-sales-report"

export type RawPrice = {
  amount?: unknown
  currency_code?: string | null
  price_list_id?: string | null
  rules_count?: number | null
}

export type RawProduct = {
  id: string
  variants?:
    | {
        id: string
        manage_inventory?: boolean | null
        metadata?: Record<string, unknown> | null
        prices?: RawPrice[] | null
        inventory_items?:
          | {
              inventory?: {
                location_levels?:
                  | { stocked_quantity?: unknown; reserved_quantity?: unknown }[]
                  | null
              } | null
            }[]
          | null
      }[]
    | null
}

export type RawSourcingItem = {
  published_product_id: string | null
  cost_usd: unknown
  published_at?: Date | string | null
  draft_order?: {
    landed_cost_multiplier?: unknown
    received_at?: Date | string | null
  } | null
}

export type SnapVariant = {
  id: string
  /** Units available to sell (stocked minus reserved, never below 0). */
  stock: number
  priceMur: number | null
  /** variant.metadata.cost_mur as stored (collection28 holds it x100). */
  costMur: number | null
}

export type SnapProduct = { id: string; variants: SnapVariant[] }

export type StockValue = {
  units: number
  cost_value_mur: number
  retail_value_mur: number
  /** Units of products with no known cost (not in cost_value_mur). */
  uncosted_units: number
  /** Products with at least one unit in stock. */
  products: number
}

/** Number() calls valueOf(), which BigNumber implements; `.value` would read 0. */
function num(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * variant.metadata.cost_mur in rupees. The inventory-audit import stored
 * collection28 costs x100 (52385 for a Rs 975 dress), so a cost three or
 * more times the price is divided by 100.
 */
export function normaliseCostMur(cost: number | null, priceMur: number | null): number | null {
  if (cost == null || !Number.isFinite(cost) || cost <= 0) return null
  if (priceMur != null && priceMur > 0 && cost / priceMur >= 3) return cost / 100
  return cost
}

/**
 * Landed unit cost of a sourcing item in MUR, as the sourcing sheet shows it:
 * cost_usd x fx x the batch's landed multiplier. The price formula's flat add
 * is price padding, not cost, so it isn't included.
 */
export function landedUnitCostMur(
  costUsd: number,
  fxRate: number,
  landedMultiplier: number,
): number {
  return costUsd * fxRate * landedMultiplier
}

/** The plain MUR price: not a sale price list's, preferring one with no rules. */
export function plainMurPrice(prices: RawPrice[] | null | undefined): number | null {
  const mur = (prices ?? []).filter(
    (p) => p.currency_code?.toLowerCase() === "mur" && !p.price_list_id,
  )
  const plain = mur.find((p) => !p.rules_count) ?? mur[0]
  return plain ? num(plain.amount) : null
}

export function toSnapProducts(rows: RawProduct[]): SnapProduct[] {
  return rows.map((p) => ({
    id: p.id,
    variants: (p.variants ?? [])
      .filter((v) => v.manage_inventory !== false)
      .map((v) => {
        let units = 0
        for (const item of v.inventory_items ?? []) {
          for (const lvl of item.inventory?.location_levels ?? []) {
            units += (num(lvl.stocked_quantity) ?? 0) - (num(lvl.reserved_quantity) ?? 0)
          }
        }
        return {
          id: v.id,
          stock: Math.max(0, units),
          priceMur: plainMurPrice(v.prices),
          costMur: num(v.metadata?.cost_mur),
        }
      }),
  }))
}

function arrivalDay(item: RawSourcingItem): string {
  const at = item.draft_order?.received_at ?? item.published_at ?? null
  return at ? muDay(at) : ""
}

/**
 * Product id -> landed unit cost of its latest sourcing batch (by arrival day).
 * A cost of 0 is kept: the product then falls back to its variants' cost_mur,
 * exactly like the admin report.
 */
export function pickSourcingCosts(
  items: RawSourcingItem[],
  fxRate: number,
): Map<string, number> {
  const latest = new Map<string, { day: string; cost: number }>()
  for (const it of items) {
    if (!it.published_product_id || !it.draft_order) continue
    const day = arrivalDay(it)
    const prev = latest.get(it.published_product_id)
    if (prev && !(day > prev.day)) continue
    latest.set(it.published_product_id, {
      day,
      cost: landedUnitCostMur(
        num(it.cost_usd) ?? 0,
        fxRate,
        num(it.draft_order.landed_cost_multiplier) ?? 0,
      ),
    })
  }
  return new Map([...latest].map(([id, v]) => [id, v.cost]))
}

export function computeStockValue(
  products: SnapProduct[],
  sourcingCost: Map<string, number>,
): StockValue {
  let units = 0
  let cost = 0
  let retail = 0
  let uncosted = 0
  let inStock = 0

  for (const p of products) {
    let stock = 0
    for (const v of p.variants) {
      stock += v.stock
      retail += v.stock * (v.priceMur ?? 0)
    }
    if (stock === 0) continue
    inStock++
    units += stock

    let unitCost: number | null = null
    const sourced = sourcingCost.get(p.id)
    if (sourced != null && sourced > 0) {
      unitCost = sourced
    } else {
      const costs = p.variants
        .map((v) => normaliseCostMur(v.costMur, v.priceMur))
        .filter((n): n is number => n != null)
      if (costs.length) unitCost = costs.reduce((a, b) => a + b, 0) / costs.length
    }
    if (unitCost != null) cost += stock * unitCost
    else uncosted += stock
  }

  return {
    units,
    cost_value_mur: Math.round(cost),
    retail_value_mur: Math.round(retail),
    uncosted_units: uncosted,
    products: inStock,
  }
}
