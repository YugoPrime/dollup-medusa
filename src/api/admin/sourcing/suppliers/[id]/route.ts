import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { SOURCING_MODULE } from "../../../../../modules/sourcing"
import type SourcingModuleService from "../../../../../modules/sourcing/service"

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

export const PATCH = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const id = req.params.id
    const body = (req.body ?? {}) as Record<string, unknown>
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    if (body.archived === true) {
      const supplier = await service.archiveSupplier(id)
      return res.json({ supplier })
    }
    if (body.archived === false) {
      const supplier = await service.unarchiveSupplier(id)
      return res.json({ supplier })
    }
    const supplier = await service.updateSupplier(id, {
      name: body.name === undefined ? undefined : String(body.name),
      contact_handle:
        body.contact_handle === undefined
          ? undefined
          : body.contact_handle === null
            ? null
            : String(body.contact_handle),
      notes:
        body.notes === undefined
          ? undefined
          : body.notes === null
            ? null
            : String(body.notes),
    })
    res.json({ supplier })
  } catch (err) {
    const e = err as Error
    logError(req, `PATCH /admin/sourcing/suppliers/${req.params.id}`, e)
    res.status(400).json({ message: e.message ?? "Failed to update supplier" })
  }
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const id = req.params.id
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    await service.deleteSupplierStrict(id)
    res.json({ ok: true })
  } catch (err) {
    const e = err as Error
    logError(req, `DELETE /admin/sourcing/suppliers/${req.params.id}`, e)
    res.status(400).json({ message: e.message ?? "Failed to delete supplier" })
  }
}
