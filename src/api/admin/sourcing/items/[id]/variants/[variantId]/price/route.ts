import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { SOURCING_MODULE } from "../../../../../../../../modules/sourcing"
import type SourcingModuleService from "../../../../../../../../modules/sourcing/service"

export const PATCH = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const variantId = String(req.params.variantId)
    const body = (req.body ?? {}) as Record<string, unknown>
    const raw = body.override_price_mur
    const priceMur =
      raw === null || raw === undefined ? null : Number(raw)
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    await service.setVariantOverridePrice(variantId, priceMur)
    res.json({ ok: true })
  } catch (err) {
    const e = err as Error
    req.scope
      .resolve<{ error: (msg: string, meta?: unknown) => void }>("logger")
      .error(
        `PATCH variant price ${req.params.variantId} failed: ${e.message}`,
        { stack: e.stack },
      )
    res.status(400).json({ message: e.message ?? "Failed" })
  }
}
