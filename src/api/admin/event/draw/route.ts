import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

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
  const id = body.draw_entry_id

  if (typeof id !== "string" || id.trim().length === 0) {
    res.status(400).json({ message: "draw_entry_id is required" })
    return
  }

  try {
    const winner = await svc.updateEventDrawEntries({ id, is_winner: true })
    res.json({ winner })
  } catch (err) {
    if (err instanceof MedusaError && err.type === MedusaError.Types.NOT_FOUND) {
      res.status(404).json({ message: (err as Error).message })
      return
    }
    res.status(400).json({ message: (err as Error)?.message ?? "failed" })
  }
}
