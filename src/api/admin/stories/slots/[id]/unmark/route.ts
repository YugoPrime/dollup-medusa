import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { STORIES_MODULE } from "../../../../../../modules/stories"
import type StoriesModuleService from "../../../../../../modules/stories/service"

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const id = req.params.id
  const service = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  try {
    await service.unmark(id)
    const [slot] = await service.listStorySlots({ id })
    res.json({ slot })
  } catch (err) {
    res.status(400).json({ message: (err as Error)?.message ?? "Unmark failed" })
  }
}
