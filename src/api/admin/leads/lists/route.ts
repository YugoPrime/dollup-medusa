import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { LEADS_MODULE } from "../../../../modules/leads"
import type LeadsModuleService from "../../../../modules/leads/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const service = req.scope.resolve<LeadsModuleService>(LEADS_MODULE)
  const lists = await service.getLeadListsWithCounts()
  res.json({ lists })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const name = typeof body.name === "string" ? body.name : ""
  const service = req.scope.resolve<LeadsModuleService>(LEADS_MODULE)
  try {
    const list = await service.createLeadList({ name })
    res.json({ list })
  } catch (err) {
    res.status(400).json({
      message: (err as Error)?.message ?? "Failed to create list",
    })
  }
}
