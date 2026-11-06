import type { MedusaContainer } from "@medusajs/framework/types"

import { STORIES_MODULE } from "../../stories"
import type StoriesModuleService from "../../stories/service"
import { planBatchSlots, type StorySlotRow } from "../batch"
import type { RenderRequest } from "../types"
import { applyCallback, remoteJobToCallback } from "./callback"
import { createRenderClient, type RenderClient, type SubmitResult } from "./client"
import { readCloudRenderConfig, type CloudRenderConfig } from "./config"
import {
  buildCloudJob,
  failedJobPatch,
  MAX_SENDS_PER_SLOT,
  PUBLISH_WINDOW_MS,
  readRenderJob,
  RETRY_GAP_MS,
  type CloudJobRequest,
  type CloudSlot,
  type JobKind,
  type RenderJobState,
  type ShadowJobState,
} from "./job"

export type CloudDeps = {
  stories: Pick<
    StoriesModuleService,
    | "listStorySlots"
    | "listStoryPlans"
    | "updateSlotMetadata"
    | "updateSlotMetadataIfJob"
  >
  client: RenderClient
  cfg: CloudRenderConfig
  now: () => Date
}

/** Throws the config error unchanged when an env var is missing or invalid. */
export function createCloudDeps(scope: MedusaContainer): CloudDeps {
  const cfg = readCloudRenderConfig()
  return {
    stories: scope.resolve<StoriesModuleService>(STORIES_MODULE),
    client: createRenderClient(cfg),
    cfg,
    now: () => new Date(),
  }
}

export type DispatchOutcome = "sent" | "applied" | "rejected" | "unavailable"

export type DispatchSlotResult = {
  slot_id: string
  slot_index: number
  status: DispatchOutcome | "skipped"
  reason?: string
  template_slug?: string
}

type SendFailure = Exclude<SubmitResult, { kind: "accepted" }>

function failureMessage(res: SendFailure): string {
  return res.kind === "rejected"
    ? `render service refused the job (${res.httpStatus} ${res.error})`
    : `render service unavailable (${res.reason})`
}

/**
 * The service already holds a finished render for this job: read it and apply
 * it as its callback would. Any failed read leaves the job `sent` for the sweeper.
 */
async function applyFinished(
  deps: CloudDeps,
  job: CloudJobRequest,
  templateSlug: string,
): Promise<DispatchOutcome> {
  const remote = await deps.client.get(job.job_id)
  if (remote === "not_found" || remote === "unavailable") return "sent"
  const body = remoteJobToCallback(remote, `dollup/${templateSlug}`)
  if (!body) return "sent"
  const result = await applyCallback(deps.stories, body, deps.now())
  return result.action === "written" ? "applied" : "sent"
}

async function dispatchProd(
  deps: CloudDeps,
  slot: CloudSlot,
  req: RenderRequest,
  manual: boolean,
): Promise<DispatchOutcome> {
  const job = buildCloudJob(slot, req, "prod", deps.cfg.callbackUrl)
  const prev = readRenderJob(slot.metadata)
  const prevCount =
    typeof prev?.dispatch_count === "number" ? prev.dispatch_count : 0
  const count = manual || prev?.job_id !== job.job_id ? 1 : prevCount + 1

  const sentAt = deps.now().toISOString()
  const renderJob: RenderJobState = {
    job_id: job.job_id,
    output_key: job.output_key,
    template_slug: req.template_slug,
    slot_inputs: req.slot_inputs,
    text_overrides: req.text_overrides,
    state: "sent",
    dispatch_count: count,
    sent_at: sentAt,
  }
  // Stamp before sending, so a fast callback always finds its job.
  await deps.stories.updateSlotMetadata(slot.id, {
    render_started_at: sentAt,
    render_template_slug: req.template_slug,
    render_error: null,
    render_job: renderJob,
  })

  const res = await deps.client.submit(job)
  if (res.kind === "accepted") {
    return res.status === "done"
      ? applyFinished(deps, job, req.template_slug)
      : "sent"
  }

  // Guarded on `sent`: an unavailable POST may still have queued the job, and
  // its callback may already have landed. Never overwrite that.
  const failedAt = deps.now().toISOString()
  await deps.stories.updateSlotMetadataIfJob(
    slot.id,
    job.job_id,
    failedJobPatch(renderJob, {
      message: failureMessage(res),
      name: "CloudDispatchError",
      stage: "dispatch",
      // A refusal is permanent: max out the count so nothing re-sends it.
      dispatchCount: res.kind === "rejected" ? MAX_SENDS_PER_SLOT : count,
      failedAt,
    }),
    { is: "sent" },
  )
  return res.kind
}

/** Shadow jobs only ever touch `render_shadow`; never a production render key. */
async function dispatchShadow(
  deps: CloudDeps,
  slot: CloudSlot,
  req: RenderRequest,
): Promise<DispatchOutcome> {
  const job = buildCloudJob(slot, req, "shadow", deps.cfg.callbackUrl)
  const shadow: ShadowJobState = {
    job_id: job.job_id,
    output_key: job.output_key,
    state: "sent",
    sent_at: deps.now().toISOString(),
  }
  await deps.stories.updateSlotMetadata(slot.id, { render_shadow: shadow })

  const res = await deps.client.submit(job)
  if (res.kind === "accepted") {
    return res.status === "done"
      ? applyFinished(deps, job, req.template_slug)
      : "sent"
  }

  const failed: ShadowJobState = {
    ...shadow,
    state: "failed",
    resolved_at: deps.now().toISOString(),
    stage: "dispatch",
    message: failureMessage(res),
  }
  await deps.stories.updateSlotMetadata(slot.id, { render_shadow: failed })
  return res.kind
}

export async function dispatchSlot(
  deps: CloudDeps,
  slot: CloudSlot,
  req: RenderRequest,
  opts: { kind: JobKind; manual: boolean },
): Promise<DispatchOutcome> {
  return opts.kind === "prod"
    ? dispatchProd(deps, slot, req, opts.manual)
    : dispatchShadow(deps, slot, req)
}

/**
 * Internal skip reason: a failed job is re-sent with its stored inputs (same
 * job_id, count + 1) instead of being re-picked. Never reported as a reason.
 */
const RESEND = "resend stored job"

const isRecord = (v: unknown): v is Record<string, string> =>
  !!v && typeof v === "object" && !Array.isArray(v)

/** The slot's last cloud job as a render request, if its stored shape allows. */
function storedRequest(slot: StorySlotRow): RenderRequest | null {
  const job = readRenderJob(slot.metadata)
  if (
    !job ||
    typeof job.template_slug !== "string" ||
    !isRecord(job.slot_inputs) ||
    !isRecord(job.text_overrides)
  ) {
    return null
  }
  return {
    template_slug: job.template_slug,
    slot_inputs: job.slot_inputs,
    text_overrides: job.text_overrides,
    plan_id: slot.plan_id,
    slot_index: slot.slot_index,
  }
}

function prodSkip(
  slot: StorySlotRow,
  now: Date,
  opts: { manual: boolean; sweep: boolean },
): { reason: string; template_slug?: string } | null {
  const job = readRenderJob(slot.metadata)
  // Slots that keep (or will reuse) their template report it, so the daily
  // template cap keeps counting it for the other slots.
  const holding = (reason: string) =>
    typeof job?.template_slug === "string"
      ? { reason, template_slug: job.template_slug }
      : { reason }

  if (job?.state === "sent") return holding("in flight")
  if (job?.state === "failed" && !opts.manual) {
    if (
      typeof job.dispatch_count === "number" &&
      job.dispatch_count >= MAX_SENDS_PER_SLOT
    ) {
      return { reason: "gave up" }
    }
    const failedAt = Date.parse(job.resolved_at ?? "")
    if (opts.sweep && now.getTime() - failedAt < RETRY_GAP_MS) {
      return holding("retry later")
    }
  }
  if (
    opts.sweep &&
    new Date(slot.scheduled_at).getTime() < now.getTime() - PUBLISH_WINDOW_MS
  ) {
    return { reason: "too late to post" }
  }
  // A retry re-sends the same job, so the per-slot send cap holds. A manual
  // call re-picks instead and starts the count again.
  if (job?.state === "failed" && !opts.manual && storedRequest(slot)) {
    return holding(RESEND)
  }
  return null
}

/**
 * Sends a render job for every slot of the plan that needs one, choosing
 * templates with the same picker loop as the laptop batch renderer.
 */
export async function dispatchPlan(
  deps: CloudDeps,
  planId: string,
  opts: { kind: JobKind; force?: boolean; manual?: boolean; sweep?: boolean },
): Promise<DispatchSlotResult[]> {
  const [plan] = await deps.stories.listStoryPlans({ id: planId })
  if (!plan) throw new Error(`Plan not found: ${planId}`)

  const slots = await deps.stories.listStorySlots({ plan_id: planId })
  const manual = opts.manual === true
  const sweep = opts.sweep === true
  const now = deps.now()
  const planned = planBatchSlots(slots, {
    force: opts.force === true,
    skip:
      opts.kind === "prod"
        ? (slot) => prodSkip(slot, now, { manual, sweep })
        : undefined,
  })

  const results: DispatchSlotResult[] = []
  for (const p of planned) {
    const slot = p.slot
    const base = { slot_id: slot.id, slot_index: slot.slot_index }
    let req: RenderRequest
    let sendManual = manual
    if ("skip" in p) {
      const stored = p.skip === RESEND ? storedRequest(slot) : null
      if (!stored) {
        results.push({
          ...base,
          status: "skipped",
          reason: p.skip,
          ...(p.template_slug !== undefined ? { template_slug: p.template_slug } : {}),
        })
        continue
      }
      req = stored
      sendManual = false
    } else {
      req = { ...p.picked, plan_id: slot.plan_id, slot_index: slot.slot_index }
    }

    // One slot's failure must not stop the rest of the plan.
    try {
      const status = await dispatchSlot(deps, slot, req, {
        kind: opts.kind,
        manual: sendManual,
      })
      results.push({ ...base, status, template_slug: req.template_slug })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        JSON.stringify({
          msg: "[stories-render:dispatch]",
          event: "slot_error",
          slot_id: slot.id,
          message,
        }),
      )
      results.push({
        ...base,
        status: "unavailable",
        reason: `error: ${message}`,
        template_slug: req.template_slug,
      })
    }
  }
  return results
}

export function summarizeDispatch(r: DispatchSlotResult[]): {
  sent: number
  skipped: number
  failed: number
} {
  return {
    sent: r.filter((x) => x.status === "sent" || x.status === "applied").length,
    skipped: r.filter((x) => x.status === "skipped").length,
    failed: r.filter((x) => x.status === "rejected" || x.status === "unavailable")
      .length,
  }
}
