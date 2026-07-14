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
 * reward row to credit is `result.reward_id`, the id of the exact
 * `EventReward` `svc.spin` just created for this call (see
 * `EventDrawModuleService.spinTxn_`). This is NOT re-derived by querying
 * for the most-recently-created reward on the entry: under two
 * overlapping spins on the SAME entry (double-click / client retry), a
 * `listEventRewards({entry_id}, {order:{created_at:"DESC"}, take:1})`
 * re-query can race and return the OTHER request's reward id, crediting
 * the wrong reward and stranding the real one at status "issued".
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
      const out = await creditEventSpinPoints(req.scope, {
        entryId,
        email: entry.email,
        points: result.points,
        rewardId: result.reward_id,
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
