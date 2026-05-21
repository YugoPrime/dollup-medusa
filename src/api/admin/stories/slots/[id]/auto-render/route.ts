import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { uploadStoryRenderToR2 } from "../../../../../../lib/r2-story-uploader"
import { STORIES_MODULE } from "../../../../../../modules/stories"
import type StoriesModuleService from "../../../../../../modules/stories/service"
import type { ProductSnapshot } from "../../../../../../modules/stories/snapshot"
import { STORIES_RENDER_MODULE } from "../../../../../../modules/stories-render"
import { pickTemplate } from "../../../../../../modules/stories-render/picker"
import type StoriesRenderModuleService from "../../../../../../modules/stories-render/service"

const inFlight = new Set<string>()

/**
 * Picks the best template for one slot, kicks off the render in the
 * background, and returns 202 immediately. The render writes its result
 * to slot.metadata.render on success or slot.metadata.render_error on
 * failure. Frontend polls the slot endpoint to detect completion.
 *
 * Why fire-and-forget: rendering takes 60-120s (chrome-headless-shell
 * launch + frame capture + ffmpeg encode + R2 upload). Holding the HTTP
 * connection that long means we trip any proxy timeout in front of the
 * container (Cloudflare 100s, Coolify Traefik ~60-90s). Returning
 * immediately keeps the connection short and lets the proxy pass.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const slotId = req.params.id

  if (inFlight.has(slotId)) {
    res.status(409).json({ message: "Render in progress for this slot" })
    return
  }

  const stories = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const [slot] = await stories.listStorySlots({ id: slotId })
  if (!slot) {
    res.status(404).json({ message: "Slot not found" })
    return
  }
  if (slot.posted_at) {
    res.status(409).json({ message: "Slot is already posted" })
    return
  }

  const snapshot = (slot.product_snapshot ?? null) as ProductSnapshot | null
  const picked = pickTemplate(snapshot, slot.slot_index)
  if (!picked) {
    res.status(400).json({
      message: snapshot
        ? "No in-stock photos to render"
        : "No product picked for this slot",
    })
    return
  }

  inFlight.add(slotId)

  // Mark the slot so the frontend's poller knows a render is in progress
  // even before the background task gets a chance to run.
  await stories.updateSlotMetadata(slotId, {
    render_error: null,
    render_started_at: new Date().toISOString(),
    render_template_slug: picked.template_slug,
  })

  // When STORIES_RENDER_REMOTE_ONLY=true the Coolify container does not
  // render — chrome-headless-shell + ffmpeg OOMs the webshop-sized box and
  // restarts the container. The local CLI on a developer laptop polls and
  // renders; it clears render_started_at once the mp4 lands.
  if (process.env.STORIES_RENDER_REMOTE_ONLY === "true") {
    res.status(202).json({
      status: "queued",
      slot_id: slotId,
      template_slug: picked.template_slug,
      remote: true,
    })
    inFlight.delete(slotId)
    return
  }

  // Respond immediately. The render continues in the background.
  res.status(202).json({
    status: "queued",
    slot_id: slotId,
    template_slug: picked.template_slug,
  })

  // Background render. No await — handler has already responded.
  void (async () => {
    try {
      const renderSvc =
        req.scope.resolve<StoriesRenderModuleService>(STORIES_RENDER_MODULE)
      renderSvc.uploadToR2 = uploadStoryRenderToR2
      const render = await renderSvc.render(slot.id, picked)
      await stories.updateSlotMetadata(slot.id, {
        render,
        render_error: null,
        render_started_at: null,
      })
    } catch (err) {
      const e = err as { name?: string; message?: string; stderrTail?: string }
      console.error("[auto-render] background render failed", err)
      await stories.updateSlotMetadata(slot.id, {
        render_error: {
          message: e.message ?? "Render failed",
          name: e.name ?? "Error",
          stderr_tail: e.stderrTail ?? null,
          failed_at: new Date().toISOString(),
        },
        render_started_at: null,
      })
    } finally {
      inFlight.delete(slotId)
    }
  })()
}
