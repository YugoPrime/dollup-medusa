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
 * Picks the best template for one slot from its product snapshot, then renders
 * + uploads. Same logic as the batch endpoint, but per-slot so the SlotCard
 * can re-render a single tile without touching the rest of the day.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const slotId = req.params.id

  if (inFlight.has(slotId)) {
    res.status(409).json({ message: "Render in progress for this slot" })
    return
  }
  inFlight.add(slotId)

  try {
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

    const renderSvc =
      req.scope.resolve<StoriesRenderModuleService>(STORIES_RENDER_MODULE)
    renderSvc.uploadToR2 = uploadStoryRenderToR2

    const render = await renderSvc.render(slot.id, picked)
    await stories.updateSlotMetadata(slot.id, { render })
    res.status(200).json({ render, template_slug: picked.template_slug })
  } catch (err) {
    const e = err as { name?: string; message?: string; stderrTail?: string }
    if (e.name === "RenderTimeoutError") {
      res.status(504).json({ message: e.message })
      return
    }
    if (e.name === "RenderCliError") {
      res.status(500).json({
        message: e.stderrTail ? `Render failed\n\n${e.stderrTail}` : "Render failed",
        stderr_tail: e.stderrTail ?? e.message,
      })
      return
    }
    console.error("[auto-render] unexpected error", err)
    res.status(500).json({ message: e.message ?? "Render failed" })
  } finally {
    inFlight.delete(slotId)
  }
}
