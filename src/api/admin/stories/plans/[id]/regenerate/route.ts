import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { STORIES_MODULE } from "../../../../../../modules/stories"
import { createStoryPickDeps } from "../../../../../../lib/story-pick-deps"
import type StoriesModuleService from "../../../../../../modules/stories/service"

/**
 * Re-runs the picker for one plan's unposted slots. Uses the shared
 * createStoryPickDeps (product source + that day's grid product) so regenerate
 * and the daily auto-plan cron pick by the same rules.
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const planId = req.params.id
  const stories = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const pickDeps = createStoryPickDeps(req.scope)

  try {
    await stories.regeneratePlan(planId, pickDeps)
    const slots = (await stories.listStorySlots({ plan_id: planId }))
      .sort((a, b) => a.slot_index - b.slot_index)
    res.json({ slots })
  } catch (err) {
    const msg = (err as Error)?.message ?? "Regenerate failed"
    const status = /completed/i.test(msg) ? 409 : 400
    res.status(status).json({ message: msg })
  }
}
