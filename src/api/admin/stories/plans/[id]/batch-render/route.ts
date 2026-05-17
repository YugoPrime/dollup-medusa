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
import type { RenderResult } from "../../../../../../modules/stories-render/types"

type BatchBody = { force?: boolean }

type SlotResult =
  | {
      slot_id: string
      slot_index: number
      status: "ok"
      template_slug: string
      mp4_url: string
      duration_ms: number
    }
  | {
      slot_id: string
      slot_index: number
      status: "skipped"
      reason: string
      template_slug?: string
      mp4_url?: string
    }
  | {
      slot_id: string
      slot_index: number
      status: "error"
      message: string
      stderr_tail?: string
    }

const planLocks = new Set<string>()

/**
 * Sequentially renders every unposted slot of a plan via the picker. Already-
 * rendered slots are skipped unless `force: true`. Per-slot errors don't abort
 * the batch — the response lists each slot's outcome.
 *
 * Concurrency: 1. ffmpeg + HyperFrames already pin one CPU each; doing them in
 * parallel would just thrash the box.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const planId = req.params.id
  const body = (req.body ?? {}) as BatchBody
  const force = body.force === true

  if (planLocks.has(planId)) {
    res.status(409).json({ message: "Batch render already in progress for this plan" })
    return
  }
  planLocks.add(planId)

  try {
    const stories = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
    const [plan] = await stories.listStoryPlans({ id: planId })
    if (!plan) {
      res.status(404).json({ message: "Plan not found" })
      return
    }

    const slots = (await stories.listStorySlots({ plan_id: planId }))
      .sort((a, b) => a.slot_index - b.slot_index)

    const renderSvc =
      req.scope.resolve<StoriesRenderModuleService>(STORIES_RENDER_MODULE)
    renderSvc.uploadToR2 = uploadStoryRenderToR2

    const results: SlotResult[] = []

    for (const slot of slots) {
      if (slot.posted_at) {
        results.push({
          slot_id: slot.id,
          slot_index: slot.slot_index,
          status: "skipped",
          reason: "already posted",
        })
        continue
      }

      const existing = readExistingRender(slot.metadata)
      if (existing && !force) {
        results.push({
          slot_id: slot.id,
          slot_index: slot.slot_index,
          status: "skipped",
          reason: "already rendered",
          template_slug: existing.template_slug,
          mp4_url: existing.mp4_url,
        })
        continue
      }

      const snapshot = (slot.product_snapshot ?? null) as ProductSnapshot | null
      const picked = pickTemplate(snapshot, slot.slot_index)
      if (!picked) {
        results.push({
          slot_id: slot.id,
          slot_index: slot.slot_index,
          status: "skipped",
          reason: snapshot
            ? "no in-stock photos to render"
            : "no product picked for this slot",
        })
        continue
      }

      try {
        const render = await renderSvc.render(slot.id, picked)
        await stories.updateSlotMetadata(slot.id, { render })
        results.push({
          slot_id: slot.id,
          slot_index: slot.slot_index,
          status: "ok",
          template_slug: render.template_slug,
          mp4_url: render.mp4_url,
          duration_ms: render.duration_ms,
        })
      } catch (err) {
        const e = err as { message?: string; stderrTail?: string }
        results.push({
          slot_id: slot.id,
          slot_index: slot.slot_index,
          status: "error",
          message: e.message ?? "Render failed",
          ...(e.stderrTail ? { stderr_tail: e.stderrTail } : {}),
        })
      }
    }

    const summary = {
      ok: results.filter((r) => r.status === "ok").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      error: results.filter((r) => r.status === "error").length,
    }
    res.status(200).json({ plan_id: planId, summary, results })
  } catch (err) {
    const e = err as Error
    console.error("[batch-render] unexpected error", err)
    res.status(500).json({ message: e.message ?? "Batch render failed" })
  } finally {
    planLocks.delete(planId)
  }
}

function readExistingRender(metadata: unknown): RenderResult | null {
  if (!metadata || typeof metadata !== "object") return null
  const m = metadata as Record<string, unknown>
  const render = m.render
  if (!render || typeof render !== "object") return null
  const r = render as Record<string, unknown>
  if (typeof r.template_slug !== "string" || typeof r.mp4_url !== "string") return null
  return render as RenderResult
}
