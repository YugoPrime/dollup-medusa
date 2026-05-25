import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { LEADS_MODULE } from "../../../../../modules/leads"
import type LeadsModuleService from "../../../../../modules/leads/service"

export const PATCH = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const id = req.params.id
  if (!id || typeof id !== "string") {
    res.status(400).json({ message: "Missing list id" })
    return
  }
  const body = (req.body ?? {}) as Record<string, unknown>
  const name = typeof body.name === "string" ? body.name : ""
  const service = req.scope.resolve<LeadsModuleService>(LEADS_MODULE)
  try {
    const list = await service.renameLeadList({ id, name })
    res.json({ list })
  } catch (err) {
    res.status(400).json({
      message: (err as Error)?.message ?? "Failed to rename list",
    })
  }
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const id = req.params.id
  if (!id || typeof id !== "string") {
    res.status(400).json({ message: "Missing list id" })
    return
  }
  const query = req.query as Record<string, unknown>
  const moveTo = typeof query.move_to === "string" ? query.move_to : ""
  if (!moveTo) {
    res.status(400).json({ message: "Missing move_to query param" })
    return
  }
  const service = req.scope.resolve<LeadsModuleService>(LEADS_MODULE)
  try {
    await service.deleteLeadList({ id, move_to: moveTo })
    res.json({ id, deleted: true })
  } catch (err) {
    res.status(400).json({
      message: (err as Error)?.message ?? "Failed to delete list",
    })
  }
}
