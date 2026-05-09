import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { SOURCING_MODULE } from "../../../../../../modules/sourcing"
import type SourcingModuleService from "../../../../../../modules/sourcing/service"

export const PATCH = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const id = String(req.params.id)
    const body = (req.body ?? {}) as Record<string, unknown>
    const priceMur = Number(body.selling_price_mur)
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    const item = await service.setItemPrice(id, priceMur)
    res.json({ item })
  } catch (err) {
    const e = err as Error
    req.scope
      .resolve<{ error: (msg: string, meta?: unknown) => void }>("logger")
      .error(
        `PATCH /admin/sourcing/items/${req.params.id}/price failed: ${e.message}`,
        { stack: e.stack },
      )
    res.status(400).json({ message: e.message ?? "Failed" })
  }
}
