import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { SOURCING_MODULE } from "../../../../modules/sourcing"
import type SourcingModuleService from "../../../../modules/sourcing/service"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const supplierId = String(body.supplier_id ?? "")
  if (!supplierId) {
    return res.status(400).json({ message: "supplier_id is required" })
  }
  const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  try {
    const draft = await service.createDraft({ supplier_id: supplierId })
    res.json({ draft })
  } catch (err) {
    res.status(400).json({
      message: (err as Error).message ?? "Failed to create draft",
    })
  }
}
