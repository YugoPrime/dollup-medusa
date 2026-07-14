import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { EVENT_DRAW_MODULE } from "../../../../modules/event-draw"
import type EventDrawModuleService from "../../../../modules/event-draw/service"
import { creditEventSpinPoints } from "../../../../workflows/credit-event-spin"

/**
 * POST /store/event/spin
 *
 * Spins the wheel for `entry_id`. For a "points" slice, credits Doll
 * Rewards points via `creditEventSpinPoints` right after the spin — the
 * reward row to credit is the one `svc.spin` just created for this entry,
 * fetched by taking the most recently created `EventReward` for
 * `entry_id` (ordered `created_at` DESC, `take: 1`). This route only ever
 * awaits one `svc.spin` call at a time per request, so by the time this
 * fetch runs the just-created reward is guaranteed to be the newest row
 * for the entry (its `idempotency_key` is unique per entry+spin-index —
 * see `EventDrawModuleService.spinTxn_`).
 *
 * body: { entry_id }
 * 200 { slice, type, points, spins_remaining, credited }
 * 400 { message } — validation error (bad entry id)
 * 409 { message } — no spins left
 */
export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const entryId = (req.body as any)?.entry_id

  try {
    const result = await svc.spin(entryId)

    let credited = 0
    if (result.type === "points" && result.points > 0) {
      const entry = await svc.retrieveEventEntry(entryId)
      const [reward] = await svc.listEventRewards(
        { entry_id: entryId },
        { order: { created_at: "DESC" }, take: 1 },
      )
      const out = await creditEventSpinPoints(req.scope, {
        entryId,
        email: entry.email,
        points: result.points,
        rewardId: reward.id,
      })
      credited = out.credited
    }

    const entry = await svc.retrieveEventEntry(entryId)
    res.json({
      slice: result.slice,
      type: result.type,
      points: result.points,
      spins_remaining: entry.spins_earned - entry.spins_used,
      credited,
    })
  } catch (e) {
    const status =
      e instanceof MedusaError && e.type === MedusaError.Types.NOT_ALLOWED
        ? 409
        : 400
    res
      .status(status)
      .json({ message: e instanceof Error ? e.message : "Spin failed." })
  }
}
