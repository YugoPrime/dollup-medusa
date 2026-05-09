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

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    const filter = String(req.query.filter ?? "active")
    const suppliers =
      filter === "all"
        ? await service.listAllSuppliers()
        : filter === "archived"
          ? (await service.listAllSuppliers()).filter((s) => s.archived_at)
          : await service.listActiveSuppliers()
    res.json({ suppliers })
  } catch (err) {
    const e = err as Error
    logError(req, "GET /admin/sourcing/suppliers", e)
    res.status(400).json({ message: e.message ?? "Failed to list suppliers" })
  }
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    const supplier = await service.createSupplier({
      name: String(body.name ?? ""),
      contact_handle:
        body.contact_handle === undefined
          ? undefined
          : String(body.contact_handle ?? ""),
      notes: body.notes === undefined ? undefined : String(body.notes ?? ""),
    })
    res.json({ supplier })
  } catch (err) {
    const e = err as Error
    logError(req, "POST /admin/sourcing/suppliers", e)
    res.status(400).json({ message: e.message ?? "Failed to create supplier" })
  }
}
