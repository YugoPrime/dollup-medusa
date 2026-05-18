import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { isMetaIgConfigured } from "../../../../../../lib/meta-ig"
import { publishStorySlot } from "../../../../../../lib/publish-story-slot"
import { STORIES_MODULE } from "../../../../../../modules/stories"
import type StoriesModuleService from "../../../../../../modules/stories/service"

const inFlight = new Set<string>()

/**
 * Fire-and-forget manual "Publish now" trigger for one slot. Returns 202
 * immediately and runs the publish in the background — the IG container
 * submit + poll + media_publish flow can take 30-90s and overshoots
 * upstream proxy timeouts otherwise.
 *
 * Result lands in slot.metadata.publish (success: { media_id,
 * creation_id, published_at }) or slot.metadata.publish_error (failure)
 * via publishStorySlot. Frontend polls the slot to detect both.
 *
 * Bypasses cron cooldown + attempt cap — operator-triggered.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const slotId = req.params.id

  if (!isMetaIgConfigured()) {
    res.status(400).json({
      message:
        "Meta IG not configured: set META_PAGE_ACCESS_TOKEN + META_IG_BUSINESS_ACCOUNT_ID in env",
    })
    return
  }

  if (inFlight.has(slotId)) {
    res.status(409).json({ message: "Publish already in progress for this slot" })
    return
  }

  const stories = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const [slot] = await stories.listStorySlots({ id: slotId })
  if (!slot) {
    res.status(404).json({ message: "Slot not found" })
    return
  }
  if (slot.posted_at) {
    res.status(409).json({ message: "Slot already posted" })
    return
  }

  inFlight.add(slotId)

  // Mark "publishing now" so the frontend's poller can spin a button.
  await stories.updateSlotMetadata(slotId, {
    publish_started_at: new Date().toISOString(),
    publish_error: null,
  })

  res.status(202).json({
    status: "queued",
    slot_id: slotId,
  })

  // Background publish. publishStorySlot already writes metadata.publish
  // or metadata.publish_error on completion.
  void (async () => {
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    try {
      const result = await publishStorySlot({ scope: req.scope, slotId })
      if (result.ok) {
        logger.info(
          `[publish-now] slot ${slotId} → media ${result.media_id} in ${result.duration_ms}ms`,
        )
      } else {
        logger.error(
          `[publish-now] slot ${slotId} failed: ${result.error}`,
        )
      }
    } catch (err) {
      logger.error(
        `[publish-now] slot ${slotId} unexpected error: ${(err as Error).message}`,
      )
    } finally {
      // Always clear the in-flight marker so a retry is possible.
      await stories
        .updateSlotMetadata(slotId, { publish_started_at: null })
        .catch(() => {})
      inFlight.delete(slotId)
    }
  })()
}
