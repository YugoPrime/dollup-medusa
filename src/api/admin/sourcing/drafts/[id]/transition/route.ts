import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { SOURCING_MODULE } from "../../../../../../modules/sourcing"
import type SourcingModuleService from "../../../../../../modules/sourcing/service"
import { DRAFT_ORDER_STATUSES } from "../../../../../../modules/sourcing/models/draft-order"

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
    const to = String(body.to ?? "")
    const reason = body.reason === undefined ? undefined : String(body.reason)

    if (!(DRAFT_ORDER_STATUSES as readonly string[]).includes(to)) {
      return res.status(400).json({
        message: `to must be one of ${DRAFT_ORDER_STATUSES.join(", ")}`,
      })
    }

    const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
    const draft = await service.transitionDraft(
      req.params.id,
      to as (typeof DRAFT_ORDER_STATUSES)[number],
      { reason },
    )
    res.json({ draft })
  } catch (err) {
    const e = err as Error
    logError(
      req,
      `POST /admin/sourcing/drafts/${req.params.id}/transition`,
      e,
    )
    res.status(400).json({ message: e.message ?? "Transition failed" })
  }
}
