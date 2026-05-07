import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { STORIES_MODULE } from "../../../../../modules/stories"
import type StoriesModuleService from "../../../../../modules/stories/service"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const id = req.params.id
  const service = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const [plan] = await service.listStoryPlans({ id })
  if (!plan) {
    res.status(404).json({ message: "Plan not found" })
    return
  }
  const slots = (await service.listStorySlots({ plan_id: id }))
    .sort((a, b) => a.slot_index - b.slot_index)
  res.json({ plan, slots })
}

export const DELETE = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const id = req.params.id
  const service = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  await service.deleteStoryPlans(id)
  res.json({ deleted: true })
}
