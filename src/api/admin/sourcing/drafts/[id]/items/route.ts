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
    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    const item = await service.createItem({
      draft_order_id: req.params.id,
      working_name:
        body.working_name === undefined ? undefined : (body.working_name as string | null),
      source_url:
        body.source_url === undefined ? undefined : (body.source_url as string | null),
      source_type: body.source_type as "alibaba" | "pdf" | "manual" | undefined,
      scraped_title:
        body.scraped_title === undefined ? undefined : (body.scraped_title as string | null),
      scraped_image_url:
        body.scraped_image_url === undefined
          ? undefined
          : (body.scraped_image_url as string | null),
      cost_usd: body.cost_usd === undefined ? undefined : Number(body.cost_usd),
      notes: body.notes === undefined ? undefined : (body.notes as string | null),
      uploaded_image_r2_key:
        body.uploaded_image_r2_key === undefined
          ? undefined
          : (body.uploaded_image_r2_key as string | null),
      category_id:
        body.category_id === undefined
          ? undefined
          : (body.category_id as string | null),
    })
    res.json({ item })
  } catch (err) {
    const e = err as Error
    logError(req, `POST /admin/sourcing/drafts/${req.params.id}/items`, e)
    res.status(400).json({ message: e.message ?? "Failed to create item" })
  }
}
