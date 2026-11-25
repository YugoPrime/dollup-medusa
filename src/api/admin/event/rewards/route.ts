import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { EVENT_DRAW_MODULE } from "../../../../modules/event-draw"
import type EventDrawModuleService from "../../../../modules/event-draw/service"

/**
 * GET /admin/event/rewards
 *
 * Lists spin rewards, optionally filtered by `status` and/or `type`. This is
 * the only place a "gift" reward (weighted 2% by default, credited nowhere
 * automatically — see `spin/route.ts`, which only auto-credits
 * `type === "points"`) becomes visible for manual fulfillment. Query
 * `?type=gift&status=issued` to find gifts still owed to a winner.
 *
 * query: { status?: string, type?: string }
 * 200 { rewards, count }
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const status = req.query.status as string | undefined
  const type = req.query.type as string | undefined

  const filters: Record<string, string> = {}
  if (status) filters.status = status
  if (type) filters.type = type

  const [rewards, count] = await svc.listAndCountEventRewards(filters, {
    order: { created_at: "DESC" },
    take: 200,
  })
  res.json({ rewards, count })
}
