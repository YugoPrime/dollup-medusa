import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { SOURCING_MODULE } from "../../../../../modules/sourcing"
import type SourcingModuleService from "../../../../../modules/sourcing/service"

export const PATCH = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const id = req.params.id
  const body = (req.body ?? {}) as Record<string, unknown>
  const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  try {
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
    res.status(400).json({
      message: (err as Error).message ?? "Failed to update supplier",
    })
  }
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const id = req.params.id
  const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  try {
    await service.deleteSupplierStrict(id)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({
      message: (err as Error).message ?? "Failed to delete supplier",
    })
  }
}
