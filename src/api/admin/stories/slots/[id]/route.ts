import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { STORIES_MODULE } from "../../../../../modules/stories"
import type StoriesModuleService from "../../../../../modules/stories/service"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const id = req.params.id
  const service = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const [slot] = await service.listStorySlots({ id })
  if (!slot) {
    res.status(404).json({ message: "Slot not found" })
    return
  }
  res.json({ slot })
}

export const PATCH = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const id = req.params.id
  const body = (req.body ?? {}) as Record<string, unknown>
  const scheduledAtRaw = body.scheduled_at
  if (typeof scheduledAtRaw !== "string") {
    res.status(400).json({ message: "scheduled_at (ISO8601 string) is required" })
    return
  }
  const scheduledAt = new Date(scheduledAtRaw)
  if (Number.isNaN(scheduledAt.valueOf())) {
    res.status(400).json({ message: "scheduled_at must be a valid ISO8601 datetime" })
    return
  }
  const service = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  try {
    await service.rescheduleSlot(id, scheduledAt)
    const [slot] = await service.listStorySlots({ id })
    res.json({ slot })
  } catch (err) {
    const msg = (err as Error)?.message ?? "Reschedule failed"
    const status = /posted/i.test(msg) ? 409 : /not found/i.test(msg) ? 404 : 400
    res.status(status).json({ message: msg })
  }
}
