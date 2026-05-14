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

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    const includeArchived = req.query.archived === "1"
    const includeSummary = req.query.include_summary === "1"
    const drafts = includeSummary
      ? await service.listDraftsForSupplierWithSummary(req.params.id, {
          includeArchived,
        })
      : await service.listDraftsForSupplier(req.params.id, {
          includeArchived,
        })
    res.json({ drafts })
  } catch (err) {
    const e = err as Error
    logError(
      req,
      `GET /admin/sourcing/suppliers/${req.params.id}/drafts`,
      e,
    )
    res.status(400).json({ message: e.message ?? "Failed to list drafts" })
  }
}
