import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { STORIES_MODULE } from "../../../../../../modules/stories"
import { createMedusaProductSource } from "../../../../../../modules/stories/product-source"
import type StoriesModuleService from "../../../../../../modules/stories/service"

/**
 * Re-runs the picker for one plan's unposted slots. Uses the shared
 * createMedusaProductSource so the same query.graph wiring is used by
 * regenerate, swap-product, and the daily auto-plan cron.
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const planId = req.params.id
  const stories = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const productSource = createMedusaProductSource(req.scope)

  try {
    await stories.regeneratePlan(planId, { productSource })
    const slots = (await stories.listStorySlots({ plan_id: planId }))
      .sort((a, b) => a.slot_index - b.slot_index)
    res.json({ slots })
  } catch (err) {
    const msg = (err as Error)?.message ?? "Regenerate failed"
    const status = /completed/i.test(msg) ? 409 : 400
    res.status(status).json({ message: msg })
  }
}
