import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { EVENT_DRAW_MODULE } from "../../../../modules/event-draw"
import type EventDrawModuleService from "../../../../modules/event-draw/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const period = req.query.period as string | undefined
  const entries = await svc.listEventDrawEntries(
    period ? { draw_period: period } : {},
    { take: 5000 },
  )
  res.json({ entries })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const body = (req.body ?? {}) as Record<string, unknown>
  const id = body.draw_entry_id as string
  const winner = await svc.updateEventDrawEntries({ id, is_winner: true })
  res.json({ winner })
}
