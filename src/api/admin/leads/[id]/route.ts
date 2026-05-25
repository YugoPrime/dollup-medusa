import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { LEADS_MODULE } from "../../../../modules/leads"
import type LeadsModuleService from "../../../../modules/leads/service"
import type { UpdateLeadInput } from "../../../../modules/leads/service"

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

export const PATCH = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const id = req.params.id
  if (!id || typeof id !== "string") {
    res.status(400).json({ message: "Missing lead id" })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const patch: UpdateLeadInput = { id }
  if (body.name !== undefined) {
    patch.name = typeof body.name === "string" ? body.name : null
  }
  if (body.phone !== undefined) {
    patch.phone = typeof body.phone === "string" ? body.phone : null
  }
  if (body.note !== undefined) {
    patch.note = typeof body.note === "string" ? body.note : null
  }
  if (typeof body.list_id === "string") {
    patch.list_id = body.list_id
  }

  const service = req.scope.resolve<LeadsModuleService>(LEADS_MODULE)
  try {
    const lead = await service.updateLead(patch)
    res.json({ lead })
  } catch (err) {
    res.status(400).json({
      message: (err as Error)?.message ?? "Failed to update lead",
    })
  }
}
