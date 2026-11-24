import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { muDay, shiftDay } from "../../../lib/daily-sales-report"
import { STOCK_SNAPSHOTS_MODULE } from "../../../modules/stock-snapshots"
import type StockSnapshotsModuleService from "../../../modules/stock-snapshots/service"

const DEFAULT_DAYS = 365

function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** GET /admin/stock-snapshots?from=YYYY-MM-DD&to=YYYY-MM-DD (default: the last year). */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const q = (req.query ?? {}) as Record<string, unknown>
  const to = q.to ?? muDay(new Date())
  const from = q.from ?? shiftDay(String(to), -(DEFAULT_DAYS - 1))
  if (!isDay(from) || !isDay(to)) {
    res.status(400).json({ message: "from and to must be dates like 2026-11-25" })
    return
  }
  const service = req.scope.resolve<StockSnapshotsModuleService>(STOCK_SNAPSHOTS_MODULE)
  res.json({ snapshots: await service.listRange(from, to) })
}
