import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { SOURCING_MODULE } from "../../../../../../modules/sourcing"
import type SourcingModuleService from "../../../../../../modules/sourcing/service"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    const result = await service.goLive(req.params.id)
    res.json(result)
  } catch (err) {
    const e = err as Error
    req.scope
      .resolve<{ error: (msg: string, meta?: unknown) => void }>("logger")
      .error(`POST go-live ${req.params.id} failed: ${e.message}`, {
        stack: e.stack,
      })
    res.status(400).json({ message: e.message ?? "Failed to go live" })
  }
}
