import {
  escapeTelegramHtml,
  type TelegramSendResult,
} from "../../../lib/telegram"
import { applyCallback, remoteJobToCallback } from "./callback"
import { dispatchPlan, type CloudDeps } from "./dispatch"
import {
  failedJobPatch,
  isTooLateToPost,
  MAX_SENDS_PER_SLOT,
  readRenderJob,
  STALE_SENT_MS,
  STUCK_SENT_MS,
  type CloudSlot,
  type RenderJobState,
} from "./job"

export type SweepPlan = { id: string; plan_date: string }

export type SweepDeps = CloudDeps & {
  /** Resolves to sendTelegram's result: only `ok: false` without `skipped` is a failed delivery. */
  telegram: (html: string) => Promise<TelegramSendResult>
  upcomingPlans: () => Promise<SweepPlan[]>
  adminUrl: string
}

export type SweepSummary = {
  reconciled: number
  dispatched: number
  summaries: number
}

const MAX_FAILURE_LINES = 5
const MAX_MESSAGE_CHARS = 120

function logError(event: string, fields: Record<string, unknown>): void {
  console.error(
    JSON.stringify({ msg: "[stories-render:sweep]", event, ...fields }),
  )
}

async function planSlots(deps: SweepDeps, planId: string): Promise<CloudSlot[]> {
  const slots = (await deps.stories.listStorySlots({
    plan_id: planId,
  })) as CloudSlot[]
  return slots.filter((s) => !s.posted_at)
}

/** Writes the failure through the same guarded write the dispatcher uses. */
async function failSent(
  deps: SweepDeps,
  slot: CloudSlot,
  job: RenderJobState,
  f: { message: string; stage: string; dispatchCount: number },
): Promise<boolean> {
  return deps.stories.updateSlotMetadataIfJob(
    slot.id,
    job.job_id,
    failedJobPatch(job, {
      ...f,
      name: "CloudSweepError",
      failedAt: deps.now().toISOString(),
    }),
    { is: "sent" },
  )
}

/** Step 1: ask the service about jobs whose callback is overdue. */
async function reconcileSlot(deps: SweepDeps, slot: CloudSlot): Promise<boolean> {
  const job = readRenderJob(slot.metadata)
  if (!job || job.state !== "sent") return false
  const age = deps.now().getTime() - Date.parse(job.sent_at)
  if (!(age > STALE_SENT_MS)) return false

  const pastStuck = age > STUCK_SENT_MS
  // Past the stuck limit, any outcome that leaves the job unsettled gives up.
  const giveUp = (message: string) =>
    failSent(deps, slot, job, {
      message,
      stage: "stuck",
      dispatchCount: MAX_SENDS_PER_SLOT,
    })

  const remote = await deps.client.get(job.job_id)
  if (remote === "unavailable") {
    // Never wait forever on a slot that can no longer be posted anyway.
    return pastStuck && isTooLateToPost(slot, deps.now())
      ? giveUp("render service unreachable")
      : false
  }
  if (remote === "not_found") {
    return failSent(deps, slot, job, {
      message: "render service has no record of this job",
      stage: "dispatch",
      dispatchCount: job.dispatch_count,
    })
  }
  if (remote.status === "done" || remote.status === "failed") {
    const body = remoteJobToCallback(remote, `dollup/${job.template_slug}`)
    if (!body) {
      return pastStuck ? giveUp("service reported done without an mp4_url") : false
    }
    const res = await applyCallback(deps.stories, body, deps.now())
    if (res.action === "written") return true
    return pastStuck
      ? giveUp(`callback result ignored: ${res.reason ?? "unknown"}`)
      : false
  }
  if (!pastStuck) return false
  return giveUp(
    remote.status === "queued" || remote.status === "rendering"
      ? `job still ${remote.status} after 60 min (OPERATIONS.md: dead-letter queue)`
      : `unknown job status ${String((remote as { status: unknown }).status)}`,
  )
}

async function reconcilePlan(deps: SweepDeps, plan: SweepPlan): Promise<number> {
  let n = 0
  for (const slot of await planSlots(deps, plan.id)) {
    try {
      if (await reconcileSlot(deps, slot)) n++
    } catch (err) {
      logError("reconcile_error", {
        slot_id: slot.id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return n
}

type Settled = { slot: CloudSlot; job: RenderJobState }

// A failed slot below the cap still retries, unless it is too late to post.
const unsettled = (s: Settled, now: Date): boolean =>
  s.job.state === "sent" ||
  (s.job.state === "failed" &&
    !(s.job.dispatch_count >= MAX_SENDS_PER_SLOT) &&
    !isTooLateToPost(s.slot, now))

const notified = (slot: CloudSlot): unknown =>
  (slot.metadata as Record<string, unknown> | null)?.render_notified_job

function failureLine(s: Settled): string {
  const err = (s.slot.metadata as Record<string, any> | null)?.render_error
  const stage = typeof err?.stage === "string" ? err.stage : "unknown"
  const message =
    typeof err?.message === "string" ? err.message : "render failed"
  return `• #${s.slot.slot_index} ${escapeTelegramHtml(stage)}: ${escapeTelegramHtml(
    message.slice(0, MAX_MESSAGE_CHARS),
  )}`
}

function summaryMessage(
  deps: SweepDeps,
  plan: SweepPlan,
  claimed: Settled[],
): string {
  const failed = claimed.filter((s) => s.job.state === "failed")
  const rendered = claimed.length - failed.length
  const icon =
    failed.length === 0 ? "✅" : rendered === 0 ? "❌" : "⚠️"
  const date = escapeTelegramHtml(plan.plan_date)
  const lines = [
    `${icon} <b>Stories rendered for ${date}</b> (cloud)`,
    "",
    `Rendered: ${rendered}`,
  ]
  if (failed.length > 0) {
    lines.push(`Failed: ${failed.length}`, "", "<b>Failures:</b>")
    lines.push(...failed.slice(0, MAX_FAILURE_LINES).map(failureLine))
    if (failed.length > MAX_FAILURE_LINES) {
      lines.push(`…and ${failed.length - MAX_FAILURE_LINES} more`)
    }
  }
  lines.push(
    "",
    `<a href="${escapeTelegramHtml(deps.adminUrl)}/stories/${date}">Open in admin</a>`,
  )
  return lines.join("\n")
}

/** Step 3: one message per plan, once all its renders have settled. */
async function summarizePlan(deps: SweepDeps, plan: SweepPlan): Promise<boolean> {
  const jobs: Settled[] = []
  for (const slot of await planSlots(deps, plan.id)) {
    const job = readRenderJob(slot.metadata)
    if (job) jobs.push({ slot, job })
  }
  if (jobs.some((j) => unsettled(j, deps.now()))) return false

  const claimed: Settled[] = []
  for (const s of jobs) {
    if (notified(s.slot) === s.job.job_id) continue
    const won = await deps.stories.updateSlotMetadataIfJob(
      s.slot.id,
      s.job.job_id,
      { render_notified_job: s.job.job_id },
    )
    if (won) claimed.push(s)
  }
  if (claimed.length === 0) return false

  const sent = await deps.telegram(summaryMessage(deps, plan, claimed))
  if (sent.ok) return true
  // Dormant Telegram (no token): nothing to retry. A real failure releases the
  // claims so the next tick sends the summary again.
  if ("skipped" in sent) return false
  for (const s of claimed) {
    await deps.stories.updateSlotMetadataIfJob(s.slot.id, s.job.job_id, {
      render_notified_job: null,
    })
  }
  logError("summary_failed", { plan_id: plan.id, status: sent.status })
  return false
}

export async function sweepCloudRenders(deps: SweepDeps): Promise<SweepSummary> {
  const out: SweepSummary = { reconciled: 0, dispatched: 0, summaries: 0 }
  const plans = await deps.upcomingPlans()

  for (const plan of plans) {
    try {
      out.reconciled += await reconcilePlan(deps, plan)
    } catch (err) {
      logError("plan_error", {
        step: "reconcile",
        plan_id: plan.id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  for (const plan of plans) {
    try {
      const results = await dispatchPlan(deps, plan.id, {
        kind: "prod",
        sweep: true,
      })
      out.dispatched += results.filter(
        (r) => r.status === "sent" || r.status === "applied",
      ).length
    } catch (err) {
      logError("plan_error", {
        step: "dispatch",
        plan_id: plan.id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  for (const plan of plans) {
    try {
      if (await summarizePlan(deps, plan)) out.summaries++
    } catch (err) {
      logError("plan_error", {
        step: "summary",
        plan_id: plan.id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return out
}
