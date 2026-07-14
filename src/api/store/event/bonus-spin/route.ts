import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"

import { EVENT_DRAW_MODULE } from "../../../../modules/event-draw"
import type EventDrawModuleService from "../../../../modules/event-draw/service"

/**
 * POST /store/event/bonus-spin
 *
 * Claims a bonus spin ("review" or "social") for an existing entry.
 * Idempotent per kind — a repeat claim of the same kind is a no-op
 * (see `EventDrawModuleService.claimBonusSpin`).
 *
 * body: { entry_id, kind: "review" | "social" }
 * 200 { spins_remaining }
 */
export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const b = req.body as any
  const kind = b?.kind === "social" ? "social" : "review"

  const entry = await svc.claimBonusSpin(b?.entry_id, kind)
  res.json({ spins_remaining: entry.spins_earned - entry.spins_used })
}
