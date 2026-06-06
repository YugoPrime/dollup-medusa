import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { SOURCING_MODULE } from "../../../../../../modules/sourcing"
import type SourcingModuleService from "../../../../../../modules/sourcing/service"
import type { QueryService } from "../../../../../../modules/sourcing/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const id = String(req.params.id)
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    const validation = await service.validateForPush(id)
    // Preview is best-effort; service returns null on any failure, in which
    // case the admin hides the preview pill — push itself is unaffected.
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as QueryService
    const nextRef = await service.previewNextRef(query)
    res.json({ validation, next_ref_preview: nextRef })
  } catch (err) {
    const e = err as Error
    req.scope
      .resolve<{ error: (msg: string, meta?: unknown) => void }>("logger")
      .error(`GET push-preview ${req.params.id} failed: ${e.message}`, {
        stack: e.stack,
      })
    res.status(400).json({ message: e.message ?? "Failed" })
  }
}
