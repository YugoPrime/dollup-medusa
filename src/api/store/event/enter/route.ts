import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { EVENT_DRAW_MODULE } from "../../../../modules/event-draw"
import type EventDrawModuleService from "../../../../modules/event-draw/service"

/**
 * POST /store/event/enter
 *
 * Redeems a scratch-card code and creates the entrant's `EventEntry`
 * (1 spin, unauthenticated — entrants are identified by the email they
 * type, not a Medusa customer session).
 *
 * body: { code, email, phone, consent }
 * 200 { entry_id, spins_remaining }
 * 400 { message } — validation error (bad email/phone, code not found)
 * 409 { message } — code already redeemed
 */
export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const b = req.body as any

  try {
    const entry = await svc.createEntry({
      code: b?.code,
      email: b?.email,
      phone: b?.phone,
      consent: !!b?.consent,
      ip: req.ip,
    })
    res.json({
      entry_id: entry.id,
      spins_remaining: entry.spins_earned - entry.spins_used,
    })
  } catch (e) {
    const status =
      e instanceof MedusaError && e.type === MedusaError.Types.NOT_ALLOWED
        ? 409
        : 400
    res
      .status(status)
      .json({ message: e instanceof Error ? e.message : "Could not enter." })
  }
}
