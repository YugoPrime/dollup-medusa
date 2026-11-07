import {
  escapeTelegramHtml,
  type TelegramSendResult,
} from "../../../lib/telegram"
import { UNSENT_ALERT_KEY } from "../../stories/slot-update"
import type { StorySlotRow } from "../batch"
import { applyCallback, remoteJobToCallback } from "./callback"
import { dispatchPlan, sweepWouldPick, type CloudDeps } from "./dispatch"
import {
  countBeforeSend,
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
  /** "Still unsent" Telegrams delivered this tick. */
  alerts: number
}

const MAX_FAILURE_LINES = 5
const MAX_MESSAGE_CHARS = 120

/** A slot still unsent this long before its scheduled time gets one Telegram. */
export const UNSENT_ALERT_LEAD_MS = 3 * 60 * 60 * 1000
/** Claim value for a slot with no render job (otherwise the claim is the job id). */
const NO_JOB_CLAIM = "no_job"

const muTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Indian/Mauritius",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

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
    // The send never reached the service, so it does not count toward the cap.
    return failSent(deps, slot, job, {
      message: "render service has no record of this job",
      stage: "dispatch",
      dispatchCount: countBeforeSend(job.dispatch_count),
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

/** The slot's last render error as escaped HTML: "stage: message". */
function lastErrorHtml(slot: CloudSlot): string {
  const err = (slot.metadata as Record<string, any> | null)?.render_error
  const stage = typeof err?.stage === "string" ? err.stage : "unknown"
  const message =
    typeof err?.message === "string" ? err.message : "render failed"
  return `${escapeTelegramHtml(stage)}: ${escapeTelegramHtml(
    message.slice(0, MAX_MESSAGE_CHARS),
  )}`
}

function failureLine(s: Settled): string {
  return `• #${s.slot.slot_index} ${lastErrorHtml(s.slot)}`
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

/** A slot that has not reached the service, and why (escaped HTML). */
type Unsent = { slot: CloudSlot; job: RenderJobState | null; reasonHtml: string }

/**
 * Unposted, unrendered and still sendable: a failed job below the send cap (it
 * will be retried), or no job at all on a slot the sweep's dispatch would send.
 * Only inside the alert window and while the slot can still post.
 */
function unsentSlot(slot: CloudSlot, wouldPick: Set<string>, now: Date): Unsent | null {
  const alertFrom = new Date(slot.scheduled_at).getTime() - UNSENT_ALERT_LEAD_MS
  if (now.getTime() < alertFrom || isTooLateToPost(slot, now)) return null
  if ((slot.metadata as Record<string, unknown> | null)?.render != null) return null
  const job = readRenderJob(slot.metadata)
  if (!job) {
    return wouldPick.has(slot.id) ? { slot, job: null, reasonHtml: "never sent" } : null
  }
  if (job.state !== "failed" || job.dispatch_count >= MAX_SENDS_PER_SLOT) return null
  return { slot, job, reasonHtml: lastErrorHtml(slot) }
}

function unsentMessage(deps: SweepDeps, plan: SweepPlan, u: Unsent): string {
  const date = escapeTelegramHtml(plan.plan_date)
  return [
    `⏰ <b>Story #${u.slot.slot_index} for ${date} not sent yet</b> (cloud)`,
    "",
    `Scheduled: ${muTime.format(new Date(u.slot.scheduled_at))} Mauritius time`,
    `Reason: ${u.reasonHtml}`,
    "",
    `<a href="${escapeTelegramHtml(deps.adminUrl)}/stories/${date}">Open in admin</a>`,
  ].join("\n")
}

/**
 * Step 4: one Telegram per slot still unsent UNSENT_ALERT_LEAD_MS before its
 * time. Uncounted sends (service unreachable) never reach the cap, so the plan
 * summary can wait for hours; this says so while there is time to act.
 */
async function alertUnsentPlan(deps: SweepDeps, plan: SweepPlan): Promise<number> {
  const now = deps.now()
  const slots = await planSlots(deps, plan.id)
  const wouldPick = sweepWouldPick(slots as unknown as StorySlotRow[], now)
  let alerts = 0
  for (const slot of slots) {
    const u = unsentSlot(slot, wouldPick, now)
    if (!u) continue
    // Claimed once per job (the job id); for a slot with no job, once until a
    // swap or clear drops the claim.
    const claim = u.job?.job_id ?? NO_JOB_CLAIM
    const asRead = {
      product_id: slot.product_id ?? null,
      pick_attempt: slot.pick_attempt ?? null,
    }
    if ((slot.metadata as Record<string, unknown> | null)?.[UNSENT_ALERT_KEY] === claim) {
      continue
    }
    const won = await deps.stories.claimSlotMetadata(
      slot.id,
      UNSENT_ALERT_KEY,
      claim,
      u.job
        ? { jobId: u.job.job_id, state: { is: "failed" } }
        : { jobId: null, ...asRead },
    )
    if (!won) continue

    const sent = await deps.telegram(unsentMessage(deps, plan, u))
    if (sent.ok) {
      alerts++
      continue
    }
    // As the summary: dormant Telegram keeps the claim, a real failure releases it.
    if ("skipped" in sent) continue
    const release = { [UNSENT_ALERT_KEY]: null }
    if (u.job) {
      await deps.stories.updateSlotMetadataIfJob(slot.id, u.job.job_id, release)
    } else {
      await deps.stories.updateSlotMetadataIfUnchanged(slot.id, asRead, release)
    }
    logError("unsent_alert_failed", { slot_id: slot.id, status: sent.status })
  }
  return alerts
}

export async function sweepCloudRenders(deps: SweepDeps): Promise<SweepSummary> {
  const out: SweepSummary = { reconciled: 0, dispatched: 0, summaries: 0, alerts: 0 }
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

  for (const plan of plans) {
    try {
      out.alerts += await alertUnsentPlan(deps, plan)
    } catch (err) {
      logError("plan_error", {
        step: "unsent_alert",
        plan_id: plan.id,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return out
}
