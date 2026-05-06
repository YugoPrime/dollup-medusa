import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { SOURCING_MODULE } from "../../../../modules/sourcing"
import type SourcingModuleService from "../../../../modules/sourcing/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  const filter = String(req.query.filter ?? "active")
  const suppliers =
    filter === "all"
      ? await service.listAllSuppliers()
      : filter === "archived"
        ? (await service.listAllSuppliers()).filter((s) => s.archived_at)
        : await service.listActiveSuppliers()
  res.json({ suppliers })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  try {
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
    res.status(400).json({
      message: (err as Error).message ?? "Failed to create supplier",
    })
  }
}
