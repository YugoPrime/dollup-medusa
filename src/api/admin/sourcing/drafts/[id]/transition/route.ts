import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { SOURCING_MODULE } from "../../../../../../modules/sourcing"
import type SourcingModuleService from "../../../../../../modules/sourcing/service"
import { DRAFT_ORDER_STATUSES } from "../../../../../../modules/sourcing/models/draft-order"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const to = String(body.to ?? "")
  const reason = body.reason === undefined ? undefined : String(body.reason)

  if (!(DRAFT_ORDER_STATUSES as readonly string[]).includes(to)) {
    return res.status(400).json({
      message: `to must be one of ${DRAFT_ORDER_STATUSES.join(", ")}`,
    })
  }

  const service = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  try {
    const draft = await service.transitionDraft(
      req.params.id,
      to as (typeof DRAFT_ORDER_STATUSES)[number],
      { reason },
    )
    res.json({ draft })
  } catch (err) {
    res.status(400).json({
      message: (err as Error).message ?? "Transition failed",
    })
  }
}
