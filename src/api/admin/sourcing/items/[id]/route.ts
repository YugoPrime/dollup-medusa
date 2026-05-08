import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { SOURCING_MODULE } from "../../../../../modules/sourcing"
import type SourcingModuleService from "../../../../../modules/sourcing/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  try {
    const item = await service.retrieveItem(req.params.id)
    const variants = await service.listVariants(item.id)
    const history = await service.listCostHistory(item.id)
    res.json({ item: { ...item, variants, cost_history: history } })
  } catch (err) {
    res.status(404).json({
      message: (err as Error).message ?? "Item not found",
    })
  }
}

export const PATCH = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  try {
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
      },
      { reason: body.reason === undefined ? undefined : String(body.reason) },
    )
    res.json({ item })
  } catch (err) {
    res.status(400).json({
      message: (err as Error).message ?? "Failed to update item",
    })
  }
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  try {
    await service.deleteItem(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({
      message: (err as Error).message ?? "Failed to delete item",
    })
  }
}
