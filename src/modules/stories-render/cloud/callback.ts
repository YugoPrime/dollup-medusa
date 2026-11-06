import type StoriesModuleService from "../../stories/service"
import type { RenderResult } from "../types"
import type { RemoteJob } from "./client"
import {
  parseCloudJobId,
  readRenderJob,
  readShadowJob,
  type CloudSlot,
  type JobKind,
} from "./job"
import { verifyRenderSignature } from "./signature"

export type CallbackBody =
  | {
      job_id: string
      status: "ok"
      mp4_url: string
      duration_ms: number
      width: number
      height: number
      fps: number
      template: string
    }
  | {
      job_id: string
      status: "error"
      stage: string
      message: string
      stderr_tail?: string | null
    }

export type CallbackDecision =
  | { action: "ignore"; reason: string }
  | {
      action: "write"
      kind: JobKind
      slotId: string
      guardJobId: string | null
      patch: Record<string, unknown>
    }

const isStr = (v: unknown): v is string => typeof v === "string"
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v)

export function parseCallbackBody(json: unknown): CallbackBody | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null
  const b = json as Record<string, unknown>
  if (!isStr(b.job_id) || b.job_id === "") return null

  if (b.status === "ok") {
    if (
      !isStr(b.mp4_url) ||
      !isNum(b.duration_ms) ||
      !isNum(b.width) ||
      !isNum(b.height) ||
      !isNum(b.fps) ||
      !isStr(b.template)
    ) {
      return null
    }
    return {
      job_id: b.job_id,
      status: "ok",
      mp4_url: b.mp4_url,
      duration_ms: b.duration_ms,
      width: b.width,
      height: b.height,
      fps: b.fps,
      template: b.template,
    }
  }

  if (b.status === "error") {
    if (!isStr(b.stage) || !isStr(b.message)) return null
    const tail = b.stderr_tail
    if (tail !== undefined && tail !== null && !isStr(tail)) return null
    const out: CallbackBody = {
      job_id: b.job_id,
      status: "error",
      stage: b.stage,
      message: b.message,
    }
    if (tail !== undefined) out.stderr_tail = tail
    return out
  }

  return null
}

const ignore = (reason: string): CallbackDecision => ({
  action: "ignore",
  reason,
})

function outputPathMatches(mp4Url: string, outputKey: unknown): boolean {
  if (!isStr(outputKey)) return false
  try {
    return new URL(mp4Url).pathname === "/" + outputKey
  } catch {
    return false
  }
}

export function decideCallbackWrite(
  slot: CloudSlot | null,
  body: CallbackBody,
  now: Date
): CallbackDecision {
  const parsed = parseCloudJobId(body.job_id)
  if (!parsed) return ignore("unknown job id")
  if (!slot) return ignore("slot not found")

  const resolvedAt = now.toISOString()

  if (parsed.kind === "shadow") {
    const shadow = readShadowJob(slot.metadata)
    if (shadow?.job_id !== body.job_id) return ignore("stale shadow job")
    const next =
      body.status === "ok"
        ? {
            ...shadow,
            state: "done",
            resolved_at: resolvedAt,
            mp4_url: body.mp4_url,
            duration_ms: body.duration_ms,
          }
        : {
            ...shadow,
            state: "failed",
            resolved_at: resolvedAt,
            stage: body.stage,
            message: body.message,
          }
    return {
      action: "write",
      kind: "shadow",
      slotId: slot.id,
      guardJobId: null,
      patch: { render_shadow: next },
    }
  }

  if (slot.posted_at) return ignore("slot already posted")
  const job = readRenderJob(slot.metadata)
  if (!job || job.job_id !== body.job_id) return ignore("stale job")

  if (body.status === "ok") {
    if (!outputPathMatches(body.mp4_url, job.output_key)) {
      return ignore("mp4_url does not match output_key")
    }
    if (job.state === "done") return ignore("duplicate")
    const render: RenderResult = {
      mp4_url: body.mp4_url,
      template_slug: job.template_slug,
      slot_inputs: job.slot_inputs,
      text_overrides: job.text_overrides,
      generated_at: resolvedAt,
      duration_ms: body.duration_ms,
      width: body.width,
      height: body.height,
      fps: body.fps,
    }
    return {
      action: "write",
      kind: "prod",
      slotId: slot.id,
      guardJobId: job.job_id,
      patch: {
        render,
        render_started_at: null,
        render_error: null,
        render_job: { ...job, state: "done", resolved_at: resolvedAt },
      },
    }
  }

  if (job.state !== "sent") return ignore("duplicate or superseded")
  return {
    action: "write",
    kind: "prod",
    slotId: slot.id,
    guardJobId: job.job_id,
    patch: {
      render_error: {
        message: body.message,
        name: "CloudRenderError",
        stage: body.stage,
        stderr_tail: body.stderr_tail ?? null,
        failed_at: resolvedAt,
      },
      render_started_at: null,
      render_job: { ...job, state: "failed", resolved_at: resolvedAt },
    },
  }
}

/** Poller helper: turn a status read into the same body a callback carries. */
export function remoteJobToCallback(
  remote: RemoteJob,
  template: string
): CallbackBody | null {
  if (remote.status === "done") {
    if (!remote.mp4_url) return null
    return {
      job_id: remote.job_id,
      status: "ok",
      mp4_url: remote.mp4_url,
      duration_ms: 0,
      width: 1080,
      height: 1920,
      fps: 30,
      template,
    }
  }
  if (remote.status === "failed") {
    return {
      job_id: remote.job_id,
      status: "error",
      stage: remote.error?.stage ?? "unknown",
      message: remote.error?.message ?? "render failed",
      stderr_tail: remote.error?.stderr_tail ?? null,
    }
  }
  return null
}

export type CallbackStories = Pick<
  StoriesModuleService,
  "listStorySlots" | "updateSlotMetadata" | "updateSlotMetadataIfJob"
>

export async function applyCallback(
  stories: CallbackStories,
  body: CallbackBody,
  now: Date
): Promise<{ action: "written" | "ignored"; reason?: string }> {
  const parsed = parseCloudJobId(body.job_id)
  if (!parsed) return { action: "ignored", reason: "unknown job id" }

  const [slot] = await stories.listStorySlots({ id: parsed.slotId })
  const decision = decideCallbackWrite(
    (slot as CloudSlot | undefined) ?? null,
    body,
    now
  )
  if (decision.action === "ignore") {
    return { action: "ignored", reason: decision.reason }
  }

  if (decision.guardJobId === null) {
    await stories.updateSlotMetadata(decision.slotId, decision.patch)
    return { action: "written" }
  }
  const wrote = await stories.updateSlotMetadataIfJob(
    decision.slotId,
    decision.guardJobId,
    decision.patch
  )
  return wrote
    ? { action: "written" }
    : { action: "ignored", reason: "slot changed while writing" }
}

export type CallbackResponse = {
  status: 200 | 400 | 401 | 500
  body: Record<string, unknown>
}

export async function handleRenderCallback(
  deps: {
    apply: (b: CallbackBody) => Promise<{ action: string; reason?: string }>
    secret: string
    nowSec: number
  },
  rawBody: Buffer,
  signature: string | undefined
): Promise<CallbackResponse> {
  if (!verifyRenderSignature(rawBody, signature, deps.secret, deps.nowSec)) {
    return { status: 401, body: { error: "bad signature" } }
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody.toString("utf8"))
  } catch {
    return { status: 400, body: { error: "invalid json" } }
  }
  const body = parseCallbackBody(json)
  if (!body) return { status: 400, body: { error: "invalid body" } }

  try {
    const result = await deps.apply(body)
    console.log(
      JSON.stringify({
        msg: "[stories-render:callback]",
        job_id: body.job_id,
        status: body.status,
        action: result.action,
        reason: result.reason,
      })
    )
    return {
      status: 200,
      body: { ok: true, action: result.action, reason: result.reason },
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: "[stories-render:callback]",
        job_id: body.job_id,
        status: body.status,
        action: "error",
        reason: err instanceof Error ? err.message : "apply failed",
      })
    )
    return { status: 500, body: { error: "apply failed" } }
  }
}
