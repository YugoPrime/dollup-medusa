import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { EVENT_DRAW_MODULE } from "../../../../modules/event-draw"
import type EventDrawModuleService from "../../../../modules/event-draw/service"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const body = (req.body ?? {}) as Record<string, unknown>
  const codes = await svc.generateCodeBatch(
    Number(body.count),
    String(body.batch_id ?? "batch"),
  )
  res.json({ codes })
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<EventDrawModuleService>(EVENT_DRAW_MODULE)
  const batch = req.query.batch_id as string | undefined
  const codes = await svc.listEventCodes(
    batch ? { batch_id: batch } : {},
    { take: 5000 },
  )
  res.json({ codes })
}
