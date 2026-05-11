import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { LEADS_MODULE } from "../../../modules/leads"
import type LeadsModuleService from "../../../modules/leads/service"
import type { CreateLeadInput } from "../../../modules/leads/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const service = req.scope.resolve<LeadsModuleService>(LEADS_MODULE)
  const leads = await service.listActiveLeads()
  res.json({ leads })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const input: CreateLeadInput = {
    name: typeof body.name === "string" ? body.name : null,
    phone: typeof body.phone === "string" ? body.phone : null,
    note: typeof body.note === "string" ? body.note : null,
  }

  const service = req.scope.resolve<LeadsModuleService>(LEADS_MODULE)
  try {
    const lead = await service.createLead(input)
    res.json({ lead })
  } catch (err) {
    res.status(400).json({
      message: (err as Error)?.message ?? "Failed to create lead",
    })
  }
}
