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

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    const item = await service.retrieveItem(req.params.id)
    const variants = await service.listVariants(item.id)
    const history = await service.listCostHistory(item.id)
    res.json({ item: { ...item, variants, cost_history: history } })
  } catch (err) {
    const e = err as Error
    logError(req, `GET /admin/sourcing/items/${req.params.id}`, e)
    res.status(404).json({ message: e.message ?? "Item not found" })
  }
}

export const PATCH = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    const item = await service.updateItem(
      req.params.id,
      {
        working_name:
          body.working_name === undefined
            ? undefined
            : (body.working_name as string | null),
        cost_usd: body.cost_usd === undefined ? undefined : Number(body.cost_usd),
        notes: body.notes === undefined ? undefined : (body.notes as string | null),
        scraped_title:
          body.scraped_title === undefined
            ? undefined
            : (body.scraped_title as string | null),
        scraped_image_url:
          body.scraped_image_url === undefined
            ? undefined
            : (body.scraped_image_url as string | null),
        source_url:
          body.source_url === undefined ? undefined : (body.source_url as string | null),
        source_type: body.source_type as "alibaba" | "pdf" | "manual" | undefined,
        uploaded_image_r2_key:
          body.uploaded_image_r2_key === undefined
            ? undefined
            : (body.uploaded_image_r2_key as string | null),
        category_id:
          body.category_id === undefined
            ? undefined
            : (body.category_id as string | null),
      },
      { reason: body.reason === undefined ? undefined : String(body.reason) },
    )
    res.json({ item })
  } catch (err) {
    const e = err as Error
    logError(req, `PATCH /admin/sourcing/items/${req.params.id}`, e)
    res.status(400).json({ message: e.message ?? "Failed to update item" })
  }
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  try {
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    await service.deleteItem(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    const e = err as Error
    logError(req, `DELETE /admin/sourcing/items/${req.params.id}`, e)
    res.status(400).json({ message: e.message ?? "Failed to delete item" })
  }
}
