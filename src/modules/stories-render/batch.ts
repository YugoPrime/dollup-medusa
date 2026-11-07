import type { MedusaContainer } from "@medusajs/framework/types"

import { uploadStoryRenderToR2 } from "../../lib/r2-story-uploader"
import { STORIES_MODULE } from "../stories"
import type StoriesModuleService from "../stories/service"
import type { ProductSnapshot } from "../stories/snapshot"
import { STORIES_RENDER_MODULE } from "./index"
import { pickTemplate, type PickedRender } from "./picker"
import type StoriesRenderModuleService from "./service"
import type { RenderResult } from "./types"

export type BatchSlotResult =
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

/**
 * Sequentially renders every unposted slot of a plan via the auto-picker.
 * Concurrency = 1: ffmpeg + HyperFrames each pin a CPU, running them in
 * parallel just thrashes the box. Per-slot errors don't abort the batch.
 *
 * Already-rendered slots are skipped unless `force: true`. Slots without
 * a snapshot or images are skipped with a descriptive reason.
 *
 * No HTTP / locking concerns — callers (route + cron) layer those on top.
 */
export async function batchRenderPlan(
  scope: MedusaContainer,
  planId: string,
  opts: { force?: boolean } = {},
): Promise<BatchSlotResult[]> {
  const force = opts.force === true
  const stories = scope.resolve<StoriesModuleService>(STORIES_MODULE)

  const [plan] = await stories.listStoryPlans({ id: planId })
  if (!plan) throw new Error(`Plan not found: ${planId}`)

  const slots = await stories.listStorySlots({ plan_id: planId })

  const renderSvc =
    scope.resolve<StoriesRenderModuleService>(STORIES_RENDER_MODULE)
  renderSvc.uploadToR2 = uploadStoryRenderToR2

  const results: BatchSlotResult[] = []

  for (const planned of planBatchSlots(slots, { force })) {
    const slot = planned.slot
    if ("skip" in planned) {
      results.push({
        slot_id: slot.id,
        slot_index: slot.slot_index,
        status: "skipped",
        reason: planned.skip,
        ...(planned.template_slug !== undefined
          ? { template_slug: planned.template_slug }
          : {}),
        ...(planned.mp4_url !== undefined ? { mp4_url: planned.mp4_url } : {}),
      })
      continue
    }
    const picked = planned.picked

    // Stamp "rendering now" so per-slot pollers in the admin UI can show a
    // spinner on this slot while it processes. Cleared on success/failure.
    await stories.updateSlotMetadata(slot.id, {
      render_started_at: new Date().toISOString(),
      render_template_slug: picked.template_slug,
      render_error: null,
    })

    try {
      const render = await renderSvc.render(slot.id, {
        ...picked,
        plan_id: slot.plan_id,
        slot_index: slot.slot_index,
      })
      await stories.updateSlotMetadata(slot.id, {
        render,
        render_started_at: null,
        render_error: null,
      })
      results.push({
        slot_id: slot.id,
        slot_index: slot.slot_index,
        status: "ok",
        template_slug: render.template_slug,
        mp4_url: render.mp4_url,
        duration_ms: render.duration_ms,
      })
    } catch (err) {
      const e = err as { name?: string; message?: string; stderrTail?: string }
      await stories.updateSlotMetadata(slot.id, {
        render_error: {
          message: e.message ?? "Render failed",
          name: e.name ?? "Error",
          stderr_tail: e.stderrTail ?? null,
          failed_at: new Date().toISOString(),
        },
        render_started_at: null,
      })
      results.push({
        slot_id: slot.id,
        slot_index: slot.slot_index,
        status: "error",
        message: e.message ?? "Render failed",
        ...(e.stderrTail ? { stderr_tail: e.stderrTail } : {}),
      })
    }
  }

  return results
}

export type StorySlotRow = Awaited<
  ReturnType<StoriesModuleService["listStorySlots"]>
>[number]

export type SlotRenderPlan =
  | { slot: StorySlotRow; picked: PickedRender }
  | { slot: StorySlotRow; skip: string; template_slug?: string; mp4_url?: string }

/**
 * Pure: decides, slot by slot (in slot_index order), whether to render and
 * with which template. Checks run in this order: already posted, already
 * rendered (unless `force`), `opts.skip`, the forced template, then the
 * auto-picker. Shared by the laptop batch renderer and the cloud dispatcher.
 */
export function planBatchSlots(
  slots: StorySlotRow[],
  opts: {
    force: boolean
    skip?: (slot: StorySlotRow) => { reason: string; template_slug?: string } | null
  },
): SlotRenderPlan[] {
  const sorted = [...slots].sort((a, b) => a.slot_index - b.slot_index)
  const force = opts.force

  // Per-day template count map fed back into pickTemplate so the picker can
  // enforce its MAX_TEMPLATE_PER_DAY cap. Seeded from slots that were already
  // rendered (kept on `force: false` reruns) and from the templates `opts.skip`
  // reports (e.g. renders still in flight), so the cap stays accurate when
  // we're filling in the gaps rather than rendering a fresh plan.
  const pickedSoFar = new Map<string, number>()
  const bump = (slug: string) =>
    pickedSoFar.set(slug, (pickedSoFar.get(slug) ?? 0) + 1)
  const existingOf = (slot: StorySlotRow) =>
    force ? null : readExistingRender(slot.metadata)

  for (const slot of sorted) {
    const existing = existingOf(slot)
    if (existing) bump(existing.template_slug)
  }

  // opts.skip is asked once per slot that reaches it, before any pick, so a
  // skipped slot's template counts even against slots earlier in the day.
  const skips = new Map<StorySlotRow, { reason: string; template_slug?: string }>()
  if (opts.skip) {
    for (const slot of sorted) {
      if (slot.posted_at || existingOf(slot)) continue
      const skipped = opts.skip(slot)
      if (!skipped) continue
      skips.set(slot, skipped)
      if (skipped.template_slug !== undefined) bump(skipped.template_slug)
    }
  }

  const plans: SlotRenderPlan[] = []
  for (const slot of sorted) {
    if (slot.posted_at) {
      plans.push({ slot, skip: "already posted" })
      continue
    }

    const existing = existingOf(slot)
    if (existing) {
      plans.push({
        slot,
        skip: "already rendered",
        template_slug: existing.template_slug,
        mp4_url: existing.mp4_url,
      })
      continue
    }

    const skipped = skips.get(slot)
    if (skipped) {
      plans.push({
        slot,
        skip: skipped.reason,
        ...(skipped.template_slug !== undefined
          ? { template_slug: skipped.template_slug }
          : {}),
      })
      continue
    }

    const forcedSlug = readForcedTemplate(slot.metadata)
    const snapshot = (slot.product_snapshot ?? null) as ProductSnapshot | null
    const picked: PickedRender | null = forcedSlug
      ? { template_slug: forcedSlug, slot_inputs: {}, text_overrides: {} }
      : pickTemplate(snapshot, slot.slot_index, pickedSoFar)
    if (!picked) {
      plans.push({
        slot,
        skip: snapshot
          ? "no in-stock photos to render"
          : "no product picked for this slot",
      })
      continue
    }

    // Track the pick toward today's template-diversity cap. Counted regardless
    // of whether the render itself succeeds — a failed render of template X
    // still "spent" that slot; we don't want the next slot to also pick X
    // just because the first failed.
    bump(picked.template_slug)
    plans.push({ slot, picked })
  }

  return plans
}

export function summarizeBatch(results: BatchSlotResult[]): {
  ok: number
  skipped: number
  error: number
} {
  return {
    ok: results.filter((r) => r.status === "ok").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    error: results.filter((r) => r.status === "error").length,
  }
}

/**
 * Reads `metadata.forced_template_slug` and returns it if present. Set by
 * `StoriesModuleService.addFillerSlot` for non-product editorial slots
 * (e.g. weekly how-to-order). When present, the batch renderer renders the
 * named template directly and never calls pickTemplate.
 */
export function readForcedTemplate(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const m = metadata as Record<string, unknown>
  const slug = m.forced_template_slug
  if (typeof slug !== "string" || slug.length === 0) return null
  return slug
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
