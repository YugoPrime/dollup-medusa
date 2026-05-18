import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { STORIES_MODULE } from "../../../../../../modules/stories"
import type StoriesModuleService from "../../../../../../modules/stories/service"
import { batchRenderPlan } from "../../../../../../modules/stories-render/batch"

type BatchBody = { force?: boolean }

const planLocks = new Set<string>()

/**
 * Fire-and-forget batch render. Validates the plan, returns 202
 * immediately with the queued slot count, then runs the full
 * batchRenderPlan loop in the background. Per-slot progress lands on
 * each slot via metadata.render_started_at / metadata.render /
 * metadata.render_error — frontend polls those by re-fetching the day's
 * slots every few seconds.
 *
 * Same reasoning as the auto-render route: 6 slots × 60-120s each = ~6-12
 * minutes of work, which overshoots every proxy timeout (Cloudflare 100s,
 * Coolify Traefik ~60-90s). Holding the HTTP connection that long would
 * 502 even though the renders themselves finish.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const planId = req.params.id
  const body = (req.body ?? {}) as BatchBody
  const force = body.force === true

  if (planLocks.has(planId)) {
    res.status(409).json({ message: "Batch render already in progress for this plan" })
    return
  }

  const stories = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const [plan] = await stories.listStoryPlans({ id: planId })
  if (!plan) {
    res.status(404).json({ message: "Plan not found" })
    return
  }

  // Quick scan so the operator sees how many slots will actually be queued.
  // Doesn't render anything yet — that happens in the background.
  const slots = await stories.listStorySlots({ plan_id: planId })
  let queuedCount = 0
  let skippedPostedCount = 0
  let skippedAlreadyRenderedCount = 0
  for (const s of slots) {
    if (s.posted_at) {
      skippedPostedCount++
      continue
    }
    const hasRender =
      (s.metadata as Record<string, unknown> | null)?.render != null
    if (hasRender && !force) {
      skippedAlreadyRenderedCount++
      continue
    }
    queuedCount++
  }

  planLocks.add(planId)
  res.status(202).json({
    status: "queued",
    plan_id: planId,
    queued: queuedCount,
    skipped_posted: skippedPostedCount,
    skipped_already_rendered: skippedAlreadyRenderedCount,
    force,
    remote: process.env.STORIES_RENDER_REMOTE_ONLY === "true",
  })

  // STORIES_RENDER_REMOTE_ONLY=true means the local CLI is doing the actual
  // rendering; we just release the lock and let admin polling pick up the
  // resulting mp4 once the laptop's renderer catches up.
  if (process.env.STORIES_RENDER_REMOTE_ONLY === "true") {
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    logger.info(
      `[batch-render] plan ${planId} queued for remote (${queuedCount} slot${queuedCount === 1 ? "" : "s"})`,
    )
    planLocks.delete(planId)
    return
  }

  // Background batch. Errors here are logged but don't crash the process;
  // per-slot failures already write to slot.metadata.render_error so the
  // admin UI surfaces them naturally.
  void (async () => {
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    try {
      await batchRenderPlan(req.scope, planId, { force })
      logger.info(`[batch-render] plan ${planId} completed`)
    } catch (err) {
      logger.error(
        `[batch-render] plan ${planId} failed: ${(err as Error).message}`,
      )
    } finally {
      planLocks.delete(planId)
    }
  })()
}
