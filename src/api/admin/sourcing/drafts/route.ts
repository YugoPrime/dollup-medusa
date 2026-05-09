import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { SOURCING_MODULE } from "../../../../modules/sourcing"
import type SourcingModuleService from "../../../../modules/sourcing/service"

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
    const supplierId = String(body.supplier_id ?? "")
    if (!supplierId) {
      return res.status(400).json({ message: "supplier_id is required" })
    }
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    const draft = await service.createDraft({ supplier_id: supplierId })
    res.json({ draft })
  } catch (err) {
    const e = err as Error
    logError(req, "POST /admin/sourcing/drafts", e)
    res.status(400).json({ message: e.message ?? "Failed to create draft" })
  }
}
