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
    {
      render_error: {
        message: failureMessage(res),
        name: "CloudDispatchError",
        stage: "dispatch",
        stderr_tail: null,
        failed_at: failedAt,
      },
      render_started_at: null,
      render_job: {
        ...renderJob,
        state: "failed",
        // A refusal is permanent: max out the count so nothing re-sends it.
        dispatch_count: res.kind === "rejected" ? MAX_SENDS_PER_SLOT : count,
        resolved_at: failedAt,
      },
    },
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

function prodSkip(
  slot: StorySlotRow,
  now: Date,
  opts: { manual: boolean; sweep: boolean },
): { reason: string; template_slug?: string } | null {
  const job = readRenderJob(slot.metadata)
  if (job?.state === "sent") {
    return typeof job.template_slug === "string"
      ? { reason: "in flight", template_slug: job.template_slug }
      : { reason: "in flight" }
  }
  if (job?.state === "failed") {
    if (
      !opts.manual &&
      typeof job.dispatch_count === "number" &&
      job.dispatch_count >= MAX_SENDS_PER_SLOT
    ) {
      return { reason: "gave up" }
    }
    const failedAt = Date.parse(job.resolved_at ?? "")
    if (opts.sweep && now.getTime() - failedAt < RETRY_GAP_MS) {
      return { reason: "retry later" }
    }
  }
  if (
    opts.sweep &&
    new Date(slot.scheduled_at).getTime() < now.getTime() - PUBLISH_WINDOW_MS
  ) {
    return { reason: "too late to post" }
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
    const base = { slot_id: p.slot.id, slot_index: p.slot.slot_index }
    if ("skip" in p) {
      results.push({
        ...base,
        status: "skipped",
        reason: p.skip,
        ...(p.template_slug !== undefined ? { template_slug: p.template_slug } : {}),
      })
      continue
    }
    const status = await dispatchSlot(
      deps,
      p.slot,
      {
        ...p.picked,
        plan_id: p.slot.plan_id,
        slot_index: p.slot.slot_index,
      },
      { kind: opts.kind, manual },
    )
    results.push({ ...base, status, template_slug: p.picked.template_slug })
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
