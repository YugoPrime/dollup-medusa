import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { LEADS_MODULE } from "../../../../modules/leads"
import type LeadsModuleService from "../../../../modules/leads/service"

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const id = req.params.id
  if (!id || typeof id !== "string") {
    res.status(400).json({ message: "Missing lead id" })
    return
  }

  const service = req.scope.resolve<LeadsModuleService>(LEADS_MODULE)
  try {
    await service.deleteLeadById(id)
    res.json({ id, deleted: true })
  } catch (err) {
    res.status(400).json({
      message: (err as Error)?.message ?? "Failed to delete lead",
    })
  }
}
