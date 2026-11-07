import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import {
  createCloudDeps,
  dispatchPlan,
  summarizeDispatch,
} from "../../../../../../modules/stories-render/cloud/dispatch"
import { resolveRenderMode } from "../../../../../../modules/stories-render/cloud/mode"

/**
 * Shadow run: sends every slot of the plan to the cloud render service as a
 * shadow job (results land in metadata.render_shadow, never in the production
 * render). Only available while STORIES_RENDER_MODE=shadow.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  if (resolveRenderMode() !== "shadow") {
    res
      .status(409)
      .json({ message: "Shadow renders run only when STORIES_RENDER_MODE=shadow." })
    return
  }

  const planId = req.params.id
  try {
    const deps = createCloudDeps(req.scope)
    const results = await dispatchPlan(deps, planId, {
      kind: "shadow",
      force: true,
    })
    res.status(200).json({ plan_id: planId, ...summarizeDispatch(results) })
  } catch (err) {
    const message = (err as Error)?.message ?? "Shadow render failed"
    if (message.startsWith("Plan not found")) {
      res.status(404).json({ message })
      return
    }
    res.status(500).json({ message })
  }
}
