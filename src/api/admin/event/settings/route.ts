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
  res.json(await svc.getSettings())
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const body = (req.body ?? {}) as Record<string, unknown>
  res.json(
    await svc.updateSettings({
      weights: body.weights as Record<string, number> | undefined,
      active_draw_period: body.active_draw_period as string | undefined,
    }),
  )
}
