import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

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
 * 400 { message } — validation error (bad/missing entry id)
 * 409 { message } — not allowed (mirrors sibling routes; claimBonusSpin is
 *   currently idempotent and doesn't throw NOT_ALLOWED, but the mapping is
 *   kept consistent with enter/validate-code/spin in case that changes)
 */
export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const b = req.body as any
  const kind = b?.kind === "social" ? "social" : "review"
  const entryId = b?.entry_id

  if (typeof entryId !== "string" || entryId.trim().length === 0) {
    res.status(400).json({ message: "entry_id is required" })
    return
  }

  try {
    const entry = await svc.claimBonusSpin(entryId, kind)
    res.json({ spins_remaining: entry.spins_earned - entry.spins_used })
  } catch (e) {
    const status =
      e instanceof MedusaError && e.type === MedusaError.Types.NOT_ALLOWED
        ? 409
        : 400
    res
      .status(status)
      .json({ message: e instanceof Error ? e.message : "Bonus spin failed." })
  }
}
