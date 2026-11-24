import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { takeStockSnapshot } from "../../../../modules/stock-snapshots/take-snapshot"

/** POST /admin/stock-snapshots/run: take (or retake) today's snapshot now. */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  res.json({ snapshot: await takeStockSnapshot(req.scope) })
}
