import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { SOURCING_MODULE } from "../../../../../../modules/sourcing"
import type SourcingModuleService from "../../../../../../modules/sourcing/service"

// Pre-allocate IS#### refs to every unrefed item in the draft, without pushing.
// Lets the operator name product photos by the final SKU before publishing.
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const id = String(req.params.id)
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    const refs = await service.assignRefsForDraft(id)
    res.json({ refs })
  } catch (err) {
    const e = err as Error
    req.scope
      .resolve<{ error: (msg: string, meta?: unknown) => void }>("logger")
      .error(`POST assign-refs ${req.params.id} failed: ${e.message}`, {
        stack: e.stack,
      })
    res.status(400).json({ message: e.message ?? "Failed" })
  }
}
