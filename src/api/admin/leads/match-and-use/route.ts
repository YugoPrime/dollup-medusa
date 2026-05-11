import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { LEADS_MODULE } from "../../../../modules/leads"
import type LeadsModuleService from "../../../../modules/leads/service"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const order_id = typeof body.order_id === "string" ? body.order_id : ""
  if (!order_id) {
    res.status(400).json({ message: "Missing order_id" })
    return
  }

  const service = req.scope.resolve<LeadsModuleService>(LEADS_MODULE)
  try {
    const result = await service.matchAndUse({
      name: typeof body.name === "string" ? body.name : null,
      phone: typeof body.phone === "string" ? body.phone : null,
      order_id,
    })
    res.json(result)
  } catch (err) {
    res.status(400).json({
      message: (err as Error)?.message ?? "Failed to match leads",
    })
  }
}
