import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { SOURCING_MODULE } from "../../../../../../modules/sourcing"
import type SourcingModuleService from "../../../../../../modules/sourcing/service"

function logError(
  req: AuthenticatedMedusaRequest,
  context: string,
  err: Error,
): void {
  try {
    const logger = req.scope.resolve<{
      error: (msg: string, meta?: unknown) => void
    }>("logger")
    logger.error(`${context}: ${err.message}`, { stack: err.stack })
  } catch {
    // best-effort
  }
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const pos = Number(body.position)
    if (!Number.isFinite(pos) || pos < 0 || Math.trunc(pos) !== pos) {
      return res
        .status(400)
        .json({ message: "position must be a non-negative integer" })
    }
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    await service.reorderItem(req.params.id, pos)
    res.json({ ok: true })
  } catch (err) {
    const e = err as Error
    logError(req, `POST /admin/sourcing/items/${req.params.id}/reorder`, e)
    res.status(400).json({ message: e.message ?? "Reorder failed" })
  }
}
