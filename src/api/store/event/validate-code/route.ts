import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"

import { EVENT_DRAW_MODULE } from "../../../../modules/event-draw"
import type EventDrawModuleService from "../../../../modules/event-draw/service"

/**
 * POST /store/event/validate-code
 *
 * Checks whether a scratch-card code exists and is unused, WITHOUT
 * redeeming it. Lets the storefront show "valid code" state before the
 * customer commits their email/phone on `/store/event/enter`.
 *
 * body: { code: string }
 * 200 { ok: true }
 * 400 { message } — code not found
 * 409 { message } — code already redeemed
 */
export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const code = svc.normalizeCode((req.body as any)?.code ?? "")

  const [found] = await svc.listEventCodes({ code })
  if (!found) {
    res.status(400).json({ message: "We couldn't find that code." })
    return
  }
  if (found.redeemed_at) {
    res.status(409).json({ message: "That code has already been used." })
    return
  }
  res.json({ ok: true })
}
