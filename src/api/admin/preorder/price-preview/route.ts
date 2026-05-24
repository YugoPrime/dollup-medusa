import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../modules/preorder"
import type PreorderModuleService from "../../../../modules/preorder/service"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const raw = body.sheinPriceUsd
  const sheinPriceUsd = typeof raw === "number" ? raw : Number(raw)

  if (!Number.isFinite(sheinPriceUsd) || sheinPriceUsd <= 0) {
    res
      .status(400)
      .json({ message: "sheinPriceUsd must be a positive number" })
    return
  }

  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  try {
    const result = await svc.previewPrice({ sheinPriceUsd })
    res.json({ preview: result })
  } catch (err) {
    res
      .status(400)
      .json({ message: (err as Error)?.message ?? "Failed to compute price" })
  }
}
