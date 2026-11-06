import type { CloudRenderConfig } from "./config"
import type { CloudJobRequest } from "./job"

export type SubmitResult =
  | { kind: "accepted"; status: "queued" | "rendering" | "done" }
  | { kind: "rejected"; httpStatus: number; error: string }
  | { kind: "unavailable"; reason: string }

export type RemoteJob = {
  job_id: string
  status: "queued" | "rendering" | "done" | "failed"
  attempts: number
  mp4_url: string | null
  error: { stage?: string; message?: string; stderr_tail?: string } | null
  callback_state: string
  updated_at: string
}

export type RenderClient = {
  submit(job: CloudJobRequest): Promise<SubmitResult>
  get(jobId: string): Promise<RemoteJob | "not_found" | "unavailable">
}

const DEFAULT_TIMEOUT_MS = 15_000
const PERMANENT = new Set([400, 401, 403, 409])

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await res.json()
    return body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export function createRenderClient(
  cfg: CloudRenderConfig,
  fetchImpl: typeof fetch = fetch,
  opts: { timeoutMs?: number } = {}
): RenderClient {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const auth = { authorization: `Bearer ${cfg.apiKey}` }

  // Failure reasons are the error name only: never a message that could carry
  // request details, and never the key.
  const reasonOf = (err: unknown): string =>
    err instanceof Error && err.name ? `${err.name}` : "network error"

  return {
    async submit(job) {
      try {
        const res = await fetchImpl(`${cfg.baseUrl}/v1/jobs`, {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify(job),
          signal: AbortSignal.timeout(timeoutMs),
        })
        const body = await readJson(res)
        if (res.status === 202) {
          const status = body.status
          if (status === "queued" || status === "rendering" || status === "done") {
            return { kind: "accepted", status }
          }
          return { kind: "unavailable", reason: "unexpected 202 body" }
        }
        if (PERMANENT.has(res.status)) {
          return {
            kind: "rejected",
            httpStatus: res.status,
            error: typeof body.error === "string" ? body.error : "unknown",
          }
        }
        return { kind: "unavailable", reason: `http ${res.status}` }
      } catch (err) {
        return { kind: "unavailable", reason: reasonOf(err) }
      }
    },

    async get(jobId) {
      try {
        const res = await fetchImpl(
          `${cfg.baseUrl}/v1/jobs/${encodeURIComponent(jobId)}`,
          { method: "GET", headers: auth, signal: AbortSignal.timeout(timeoutMs) }
        )
        if (res.status === 404) return "not_found"
        if (res.status !== 200) return "unavailable"
        const body = await readJson(res)
        if (typeof body.job_id !== "string") return "unavailable"
        return body as unknown as RemoteJob
      } catch {
        return "unavailable"
      }
    },
  }
}
