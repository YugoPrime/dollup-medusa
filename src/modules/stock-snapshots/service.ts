import { MedusaService } from "@medusajs/framework/utils"

import type { StockValue } from "../../lib/stock-snapshot"
import StockSnapshot from "./models/stock-snapshot"

export type StockSnapshotRow = StockValue & {
  id: string
  day: string
  created_at: Date
  updated_at: Date
}

type Generated = {
  listStockSnapshots: (
    filters: Record<string, unknown>,
    config?: Record<string, unknown>,
  ) => Promise<StockSnapshotRow[]>
  createStockSnapshots: (data: Record<string, unknown>) => Promise<StockSnapshotRow>
  updateStockSnapshots: (data: Record<string, unknown>) => Promise<StockSnapshotRow>
}

class StockSnapshotsModuleService extends MedusaService({ StockSnapshot }) {
  /** Writes the day's row, replacing an earlier run of the same day. */
  async upsertDay(day: string, value: StockValue): Promise<StockSnapshotRow> {
    const svc = this as unknown as Generated
    const [existing] = await svc.listStockSnapshots({ day }, { take: 1 })
    const fields = {
      units: value.units,
      cost_value_mur: value.cost_value_mur,
      retail_value_mur: value.retail_value_mur,
      uncosted_units: value.uncosted_units,
      products: value.products,
    }
    if (existing) return svc.updateStockSnapshots({ id: existing.id, ...fields })
    return svc.createStockSnapshots({ day, ...fields })
  }

  /** Rows from `from` to `to` (YYYY-MM-DD, both included), oldest first. */
  async listRange(from: string, to: string): Promise<StockSnapshotRow[]> {
    const svc = this as unknown as Generated
    return svc.listStockSnapshots(
      { day: { $gte: from, $lte: to } },
      { order: { day: "ASC" }, take: null },
    )
  }
}

export default StockSnapshotsModuleService
