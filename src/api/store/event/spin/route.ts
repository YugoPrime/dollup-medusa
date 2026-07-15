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
 * 200 { slice, type, points, spins_remaining, credited, credit_pending }
 * 400 { message } — validation error (bad entry id)
 * 409 { message } — no spins left
 *
 * `credit_pending: true` on an otherwise-200 response means the spin was
 * consumed and the reward row was written (status "issued"), but crediting
 * the loyalty points afterward failed — see the credit try/catch below.
 * That failure must NOT be reported as a spin failure: the spin already
 * happened, so a client that retried on a misleading 400/409 would burn a
 * second spin for a reward it already won. `credit_pending: false` (or the
 * field omitted) means credit succeeded normally.
 */
export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const entryId = (req.body as any)?.entry_id

  let result: {
    slice: string
    type: string
    points: number
    reward_id: string
  }
  try {
    result = await svc.spin(entryId)
  } catch (e) {
    const status =
      e instanceof MedusaError && e.type === MedusaError.Types.NOT_ALLOWED
        ? 409
        : 400
    res
      .status(status)
      .json({ message: e instanceof Error ? e.message : "Spin failed." })
    return
  }

  // The spin is consumed and the reward is written from here on — any
  // failure below must still surface as a 200 (see doc comment above).
  let credited = 0
  let creditPending = false
  if (result.type === "points" && result.points > 0) {
    try {
      const entryForCredit = await svc.retrieveEventEntry(entryId)
      const out = await creditEventSpinPoints(req.scope, {
        entryId,
        email: entryForCredit.email,
        points: result.points,
        rewardId: result.reward_id,
      })
      credited = out.credited
    } catch {
      creditPending = true
    }
  }

  const entry = await svc.retrieveEventEntry(entryId)
  res.json({
    slice: result.slice,
    type: result.type,
    points: result.points,
    spins_remaining: entry.spins_earned - entry.spins_used,
    credited,
    credit_pending: creditPending,
  })
}
