import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { STORIES_MODULE } from "../../../../modules/stories"
import type StoriesModuleService from "../../../../modules/stories/service"
import type { UpdateStorySettingsInput } from "../../../../modules/stories/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const service = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const settings = await service.getSettings()
  res.json({ settings })
}

export const PUT = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const input: UpdateStorySettingsInput = {}
  if (typeof body.anti_repeat_days === "number")
    input.anti_repeat_days = Math.max(1, Math.min(60, Math.trunc(body.anti_repeat_days)))
  if (typeof body.caption_template === "string")
    input.caption_template = body.caption_template
  if (Array.isArray(body.default_distribution))
    input.default_distribution = body.default_distribution as never
  if (Array.isArray(body.default_schedule))
    input.default_schedule = body.default_schedule as never
  if (typeof body.stock_alert_threshold === "number")
    input.stock_alert_threshold = Math.max(0, Math.min(50, Math.trunc(body.stock_alert_threshold)))

  const service = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  try {
    const settings = await service.updateSettings(input)
    res.json({ settings })
  } catch (err) {
    res.status(400).json({ message: (err as Error)?.message ?? "Update failed" })
  }
}
