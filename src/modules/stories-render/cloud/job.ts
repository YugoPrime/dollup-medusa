import { r2KeyFor, renderHash } from "../idempotency"
import type { RenderRequest } from "../types"

export type JobKind = "prod" | "shadow"

export type CloudSlot = {
  id: string
  plan_id: string
  slot_index: number
  scheduled_at: Date | string
  posted_at: Date | string | null
  metadata: unknown
  product_snapshot?: unknown
}

export type CloudJobRequest = {
  job_id: string
  template: string
  images: Record<string, string>
  text: Record<string, string>
  brand: null
  audio: { pool: "dollup"; seed: string; index: number }
  output_key: string
  callback_url: string
}

export const MAX_SENDS_PER_SLOT = 3
export const RETRY_GAP_MS = 600_000
export const STALE_SENT_MS = 1_200_000
export const STUCK_SENT_MS = 3_600_000
// publish skips slots more than 2 h late
export const PUBLISH_WINDOW_MS = 7_200_000

export function buildCloudJob(
  slot: Pick<CloudSlot, "id" | "plan_id" | "slot_index">,
  req: RenderRequest,
  kind: JobKind,
  callbackUrl: string
): CloudJobRequest {
  const hash = renderHash(req)
  const prod = kind === "prod"
  return {
    job_id: prod ? `${slot.id}_${hash}` : `shadow_${slot.id}_${hash}`,
    template: `dollup/${req.template_slug}`,
    images: req.slot_inputs,
    text: req.text_overrides,
    brand: null,
    audio: { pool: "dollup", seed: slot.plan_id, index: slot.slot_index },
    output_key: prod
      ? r2KeyFor(slot.id, hash)
      : `stories-shadow/${slot.id}/${hash}.mp4`,
    callback_url: callbackUrl,
  }
}

const JOB_ID_RE = /^(shadow_)?(stslot_[A-Za-z0-9]+)_([0-9a-f]{16})$/

export function parseCloudJobId(
  jobId: string
): { kind: JobKind; slotId: string; hash: string } | null {
  const m = JOB_ID_RE.exec(jobId)
  if (!m) return null
  return { kind: m[1] ? "shadow" : "prod", slotId: m[2], hash: m[3] }
}

export type RenderJobState = {
  job_id: string
  output_key: string
  template_slug: string
  slot_inputs: Record<string, string>
  text_overrides: Record<string, string>
  state: "sent" | "done" | "failed"
  dispatch_count: number
  sent_at: string
  resolved_at?: string
}

export type ShadowJobState = {
  job_id: string
  output_key: string
  state: "sent" | "done" | "failed"
  sent_at: string
  resolved_at?: string
  mp4_url?: string
  duration_ms?: number
  stage?: string
  message?: string
}

function readKey(metadata: unknown, key: string): unknown {
  if (!metadata || typeof metadata !== "object") return null
  const value = (metadata as Record<string, unknown>)[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value
}

export function readRenderJob(metadata: unknown): RenderJobState | null {
  return readKey(metadata, "render_job") as RenderJobState | null
}

export function readShadowJob(metadata: unknown): ShadowJobState | null {
  return readKey(metadata, "render_shadow") as ShadowJobState | null
}

/**
 * Metadata patch that marks a prod render job failed. `render_job` is the FULL
 * job (jsonb `||` replaces the whole key). Shared by the dispatcher and sweeper.
 */
export function failedJobPatch(
  job: RenderJobState,
  f: {
    message: string
    name: string
    stage: string
    dispatchCount: number
    failedAt: string
  }
): Record<string, unknown> {
  return {
    render_error: {
      message: f.message,
      name: f.name,
      stage: f.stage,
      stderr_tail: null,
      failed_at: f.failedAt,
    },
    render_started_at: null,
    render_job: {
      ...job,
      state: "failed",
      dispatch_count: f.dispatchCount,
      resolved_at: f.failedAt,
    },
  }
}
