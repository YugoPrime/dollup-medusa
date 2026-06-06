import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../../../../../modules/preorder"
import type PreorderModuleService from "../../../../../../../../modules/preorder/service"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const body = (req.body ?? {}) as { priceUsd?: unknown }
  const priceUsd =
    typeof body.priceUsd === "number" ? body.priceUsd : Number(body.priceUsd)
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    res.status(400).json({ message: "priceUsd must be a positive number" })
    return
  }
  try {
    await svc.setManualQuote(req.params.itemId, { priceUsd })
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ message: (err as Error)?.message ?? "failed" })
  }
}
