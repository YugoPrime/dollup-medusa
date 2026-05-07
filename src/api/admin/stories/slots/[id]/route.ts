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
