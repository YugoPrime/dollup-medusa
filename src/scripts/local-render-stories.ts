/**
 * Local Story Renderer — runs on your laptop, not in Coolify.
 *
 * The Coolify backend container is sized for a webshop; chrome-headless-shell
 * software rendering of 1080x1920 stories at 30fps is just too slow there
 * (~1-2 captured fps, vs. 30 needed). This script runs the SAME pipeline
 * (HyperFrames + ffmpeg + R2 upload) on your local machine, then writes the
 * resulting mp4 URL back to the production DB.
 *
 * It's offline-tolerant: when you bring your laptop online it scans for
 * unrendered slots in the next N days and catches up. Slots already
 * rendered are skipped via the existing batchRenderPlan idempotency check.
 *
 * Run:
 *   yarn medusa exec ./src/scripts/local-render-stories.ts
 *
 * Flags (set via env, since `medusa exec` doesn't forward CLI args cleanly):
 *   RENDER_LOOKAHEAD_DAYS   how many days forward to scan (default 7)
 *   RENDER_POLL_SECONDS     seconds between scans in daemon mode (default 300)
 *   RENDER_ONCE             "true" to render-and-exit, else loops forever
 *   RENDER_ONLY_SLOT_ID     stslot_... to render exactly one slot and exit.
 *                           Skips the plan scan entirely. Used for testing
 *                           the local pipeline end-to-end.
 *
 * Required env:
 *   DATABASE_URL, REDIS_URL — point at the production DB (read .env.production)
 *   R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL
 *   PRODUCER_HEADLESS_SHELL_PATH — optional. If unset HyperFrames downloads
 *                                  a chrome-headless-shell into ~/.cache.
 */
import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { uploadStoryRenderToR2 } from "../lib/r2-story-uploader"
import { addDaysToMauritiusDate, mauritiusToday } from "../lib/mauritius-date"
import { STORIES_MODULE } from "../modules/stories"
import type StoriesModuleService from "../modules/stories/service"
import {
  batchRenderPlan,
  summarizeBatch,
} from "../modules/stories-render/batch"
import { STORIES_RENDER_MODULE } from "../modules/stories-render"
import { pickTemplate } from "../modules/stories-render/picker"
import type StoriesRenderModuleService from "../modules/stories-render/service"
import type { ProductSnapshot } from "../modules/stories/snapshot"

type Settings = {
  lookaheadDays: number
  pollSeconds: number
  once: boolean
  onlySlotId: string | null
}

function readSettings(): Settings {
  const lookahead = Number.parseInt(
    process.env.RENDER_LOOKAHEAD_DAYS ?? "7",
    10,
  )
  const poll = Number.parseInt(process.env.RENDER_POLL_SECONDS ?? "300", 10)
  const onlySlotRaw = process.env.RENDER_ONLY_SLOT_ID?.trim()
  return {
    lookaheadDays: Number.isFinite(lookahead) && lookahead >= 1 ? lookahead : 7,
    pollSeconds: Number.isFinite(poll) && poll >= 30 ? poll : 300,
    once: process.env.RENDER_ONCE === "true" || process.env.RENDER_ONCE === "1",
    onlySlotId: onlySlotRaw && onlySlotRaw.length > 0 ? onlySlotRaw : null,
  }
}

function fmt(ts: Date = new Date()): string {
  return ts.toISOString().replace("T", " ").slice(0, 19)
}

export default async function localRenderStories({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const stories = container.resolve<StoriesModuleService>(STORIES_MODULE)
  const settings = readSettings()

  logger.info(
    `[local-render] starting | lookahead=${settings.lookaheadDays}d poll=${settings.pollSeconds}s once=${settings.once}${settings.onlySlotId ? ` only_slot=${settings.onlySlotId}` : ""}`,
  )

  // One-slot test mode: render exactly one slot, write back, exit. Bypasses
  // the plan scan entirely. Use to validate the local pipeline end-to-end
  // without rendering everything pending in the lookahead window.
  if (settings.onlySlotId) {
    await runOneSlot(container, stories, logger, settings.onlySlotId)
    logger.info(`[local-render] exiting (one-slot mode)`)
    return
  }

  let stopRequested = false
  const stop = () => {
    if (stopRequested) return
    stopRequested = true
    logger.info(`[local-render] stop requested — finishing current iteration`)
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)

  do {
    const tickStart = Date.now()
    try {
      await runOnce(container, stories, logger, settings)
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err)
      logger.error(`[local-render] iteration failed: ${msg}`)
    }

    if (settings.once || stopRequested) break

    const elapsedSec = Math.round((Date.now() - tickStart) / 1000)
    const sleepSec = Math.max(30, settings.pollSeconds - elapsedSec)
    logger.info(
      `[local-render] iteration took ${elapsedSec}s, sleeping ${sleepSec}s — next scan at ${fmt(new Date(Date.now() + sleepSec * 1000))}`,
    )
    await sleepInterruptible(sleepSec * 1000, () => stopRequested)
  } while (!stopRequested)

  logger.info(`[local-render] exiting cleanly`)
}

async function runOnce(
  container: ExecArgs["container"],
  stories: StoriesModuleService,
  logger: { info: (s: string) => void; warn: (s: string) => void; error: (s: string) => void },
  settings: Settings,
): Promise<void> {
  const today = mauritiusToday()
  const horizon = addDaysToMauritiusDate(today, settings.lookaheadDays)

  // listStoryPlans doesn't have a "between dates" filter exposed, so list a
  // generous window and filter in-process. Volumes are small (<= 30 plans).
  const allPlans = await stories.listStoryPlans({} as any, { take: 200 })
  const planDates = new Set<string>()
  for (let i = 0; i <= settings.lookaheadDays; i++) {
    planDates.add(addDaysToMauritiusDate(today, i))
  }
  const upcoming = allPlans
    .filter((p) => planDates.has(normalizeDate(p.plan_date)))
    .sort((a, b) =>
      normalizeDate(a.plan_date).localeCompare(normalizeDate(b.plan_date)),
    )

  if (upcoming.length === 0) {
    logger.info(
      `[local-render] no plans found in ${today}..${horizon} — nothing to do`,
    )
    return
  }

  logger.info(
    `[local-render] scanning ${upcoming.length} plan(s) in ${today}..${horizon}`,
  )

  let totalOk = 0
  let totalSkipped = 0
  let totalError = 0

  for (const plan of upcoming) {
    const slots = await stories.listStorySlots({ plan_id: plan.id })
    const pending = slots.filter(
      (s) => !s.posted_at && !hasExistingRender(s.metadata),
    )
    if (pending.length === 0) {
      logger.info(
        `[local-render] plan ${plan.id} (${normalizeDate(plan.plan_date)}): all ${slots.length} slot(s) already rendered or posted`,
      )
      continue
    }

    logger.info(
      `[local-render] plan ${plan.id} (${normalizeDate(plan.plan_date)}): ${pending.length}/${slots.length} slot(s) need rendering`,
    )

    const results = await batchRenderPlan(container, plan.id)
    const summary = summarizeBatch(results)
    totalOk += summary.ok
    totalSkipped += summary.skipped
    totalError += summary.error

    for (const r of results) {
      if (r.status === "ok") {
        logger.info(
          `[local-render]   ok    slot=${r.slot_id} idx=${r.slot_index} template=${r.template_slug} ${r.duration_ms}ms`,
        )
      } else if (r.status === "skipped") {
        logger.info(
          `[local-render]   skip  slot=${r.slot_id} idx=${r.slot_index} reason="${r.reason}"`,
        )
      } else {
        logger.error(
          `[local-render]   FAIL  slot=${r.slot_id} idx=${r.slot_index} msg="${r.message}"`,
        )
      }
    }
  }

  logger.info(
    `[local-render] iteration done | ok=${totalOk} skipped=${totalSkipped} errors=${totalError}`,
  )
}

async function runOneSlot(
  container: MedusaContainer,
  stories: StoriesModuleService,
  logger: { info: (s: string) => void; warn: (s: string) => void; error: (s: string) => void },
  slotId: string,
): Promise<void> {
  const [slot] = await stories.listStorySlots({ id: slotId })
  if (!slot) {
    logger.error(`[local-render] slot ${slotId} not found`)
    return
  }
  if (slot.posted_at) {
    logger.warn(`[local-render] slot ${slotId} already posted at ${slot.posted_at} — skipping`)
    return
  }

  const snapshot = (slot.product_snapshot ?? null) as ProductSnapshot | null
  const picked = pickTemplate(snapshot, slot.slot_index)
  if (!picked) {
    logger.error(
      `[local-render] slot ${slotId}: ${
        snapshot ? "no in-stock photos to render" : "no product picked for this slot"
      }`,
    )
    return
  }

  const renderSvc = container.resolve<StoriesRenderModuleService>(STORIES_RENDER_MODULE)
  renderSvc.uploadToR2 = uploadStoryRenderToR2

  await stories.updateSlotMetadata(slot.id, {
    render_started_at: new Date().toISOString(),
    render_template_slug: picked.template_slug,
    render_error: null,
  })

  const start = Date.now()
  try {
    const render = await renderSvc.render(slot.id, picked)
    await stories.updateSlotMetadata(slot.id, {
      render,
      render_started_at: null,
      render_error: null,
    })
    logger.info(
      `[local-render]   ok    slot=${slot.id} template=${render.template_slug} mp4=${render.mp4_url} ${render.duration_ms}ms`,
    )
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
    logger.error(
      `[local-render]   FAIL  slot=${slot.id} ${Date.now() - start}ms msg="${e.message ?? "Render failed"}"`,
    )
    if (e.stderrTail) logger.error(`[local-render]   stderr: ${e.stderrTail}`)
  }
}

function normalizeDate(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 10)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function hasExistingRender(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false
  const m = metadata as Record<string, unknown>
  const render = m.render
  if (!render || typeof render !== "object") return false
  const r = render as Record<string, unknown>
  return typeof r.mp4_url === "string" && r.mp4_url.length > 0
}

async function sleepInterruptible(
  ms: number,
  isCancelled: () => boolean,
): Promise<void> {
  const stepMs = 1000
  let remaining = ms
  while (remaining > 0) {
    if (isCancelled()) return
    const chunk = Math.min(stepMs, remaining)
    await new Promise((resolve) => setTimeout(resolve, chunk))
    remaining -= chunk
  }
}
