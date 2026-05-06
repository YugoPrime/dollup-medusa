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
  const body = (req.body ?? {}) as Record<string, unknown>
  const pos = Number(body.position)
  if (!Number.isFinite(pos) || pos < 0 || Math.trunc(pos) !== pos) {
    return res
      .status(400)
      .json({ message: "position must be a non-negative integer" })
  }
  const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  try {
    await service.reorderItem(req.params.id, pos)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({
      message: (err as Error).message ?? "Reorder failed",
    })
  }
}
