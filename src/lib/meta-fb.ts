/**
 * Thin client for Meta's Facebook Page Stories content-publishing flow.
 * Covers video stories specifically using file_url mode (server-side fetch
 * of a public MP4 — our Stories are R2-hosted):
 *   POST /{page_id}/video_stories?upload_phase=start&file_url=<mp4>
 *     → returns { video_id }
 *   GET  /{video_id}?fields=status              (poll until ready)
 *     → returns { status: { video_status: "ready"|"in_progress"|"error" } }
 *   POST /{page_id}/video_stories?upload_phase=finish&video_id=<id>
 *     → returns { post_id, success }
 *
 * The poll between start and finish is REQUIRED. Skipping it yields Meta
 * error 6000/1363130 "Video was not uploaded" because Meta hasn't finished
 * downloading the R2 file by the time `finish` arrives. IG's flow has the
 * same shape (see meta-ig.ts).
 *
 * No retries here — the caller (publish-story-slot) is the retry layer
 * and treats FB failure as soft-failure (IG remains source of truth).
 */

export type MetaFbConfig = {
  pageId: string
  pageAccessToken: string
  apiVersion: string
}

export class MetaFbError extends Error {
  name = "MetaFbError"
  status: number
  fbtraceId?: string
  /** When set, surface this as user-facing detail in the cron alert. */
  metaErrorCode?: number
  metaErrorSubcode?: number
  /** Meta-provided human-readable error description. Often more useful than
   *  the generic top-level `message`. e.g. on a 6000 video rejection, this
   *  may say "Aspect ratio not supported" or "Codec not supported". */
  errorUserMsg?: string
  errorUserTitle?: string
  constructor(
    message: string,
    status: number,
    extras: {
      fbtraceId?: string
      code?: number
      subcode?: number
      errorUserMsg?: string
      errorUserTitle?: string
    } = {},
  ) {
    super(message)
    this.status = status
    this.fbtraceId = extras.fbtraceId
    this.metaErrorCode = extras.code
    this.metaErrorSubcode = extras.subcode
    this.errorUserMsg = extras.errorUserMsg
    this.errorUserTitle = extras.errorUserTitle
  }
}

export function readMetaFbEnv(): MetaFbConfig | null {
  const pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN
  const pageId = process.env.META_FB_PAGE_ID
  const apiVersion = process.env.META_API_VERSION ?? "v21.0"
  if (!pageAccessToken || !pageId) return null
  return { pageAccessToken, pageId, apiVersion }
}

export function isMetaFbConfigured(): boolean {
  return readMetaFbEnv() != null
}

/**
 * True only when BOTH the env flag is "true" AND credentials are present.
 * publishStorySlot calls this to decide whether to attempt the cross-post.
 */
export function isFbCrosspostEnabled(): boolean {
  if (process.env.STORIES_CROSSPOST_FB !== "true") return false
  return isMetaFbConfigured()
}

function buildUrl(path: string, cfg: MetaFbConfig): URL {
  const cleaned = path.replace(/^\//, "")
  const url = new URL(`https://graph.facebook.com/${cfg.apiVersion}/${cleaned}`)
  url.searchParams.set("access_token", cfg.pageAccessToken)
  return url
}

async function call<T>(
  path: string,
  cfg: MetaFbConfig,
  init: RequestInit & { params?: Record<string, string> } = {},
): Promise<T> {
  const url = buildUrl(path, cfg)
  for (const [k, v] of Object.entries(init.params ?? {})) {
    url.searchParams.set(k, v)
  }
  const { params: _ignored, ...fetchInit } = init
  const res = await fetch(url, fetchInit)
  let json: any = null
  try {
    json = await res.json()
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const err = json?.error
    throw new MetaFbError(
      err?.message ?? `Meta FB API ${res.status}`,
      res.status,
      {
        fbtraceId: err?.fbtrace_id,
        code: err?.code,
        subcode: err?.error_subcode,
        errorUserMsg: err?.error_user_msg,
        errorUserTitle: err?.error_user_title,
      },
    )
  }
  return json as T
}

export type FbVideoStatus =
  | "ready"
  | "processing"
  | "in_progress"
  | "uploading"
  | "error"
  | "expired"

export async function getFbVideoStatus(
  videoId: string,
  cfg: MetaFbConfig = readMetaFbEnv() ?? throwUnconfigured(),
): Promise<{ video_status: FbVideoStatus }> {
  const result = await call<{ status?: { video_status?: string } }>(
    `${videoId}`,
    cfg,
    { method: "GET", params: { fields: "status" } },
  )
  const video_status = (result?.status?.video_status ?? "processing") as FbVideoStatus
  return { video_status }
}

export async function pollFbVideoUntilReady(
  args: {
    videoId: string
    timeoutMs?: number
    pollIntervalMs?: number
    initialDelayMs?: number
  },
  cfg: MetaFbConfig = readMetaFbEnv() ?? throwUnconfigured(),
): Promise<void> {
  // FB's video_stories file_url ingestion is materially slower than IG's
  // equivalent (Meta downloads, transcodes, then makes it ready). Observed
  // 2-3 min for our ~5MB 9:16 mp4s. Allow 5 min before giving up.
  const timeoutMs = args.timeoutMs ?? 300_000
  const pollIntervalMs = args.pollIntervalMs ?? 5000
  // First poll within ~5s of start almost always returns "processing" — skip
  // it to save one request and avoid burning a slot on a guaranteed miss.
  const initialDelayMs = args.initialDelayMs ?? 8000
  const deadline = Date.now() + timeoutMs

  if (initialDelayMs > 0) await sleep(initialDelayMs)

  while (Date.now() < deadline) {
    const { video_status } = await getFbVideoStatus(args.videoId, cfg)
    if (video_status === "ready") return
    if (video_status === "error") {
      throw new MetaFbError(
        `FB video ${args.videoId} processing failed (status=error)`,
        500,
      )
    }
    if (video_status === "expired") {
      throw new MetaFbError(
        `FB video ${args.videoId} expired before finish`,
        410,
      )
    }
    await sleep(pollIntervalMs)
  }
  throw new MetaFbError(
    `FB video ${args.videoId} did not become ready within ${timeoutMs}ms`,
    504,
  )
}

/**
 * Three-phase publish:
 *   start (file_url)        → video_id
 *   poll (until ready)
 *   finish (video_id)       → post_id
 * Returns the FB post_id on success, throws MetaFbError on any failure.
 */
export async function publishFbVideoStory(
  args: { videoUrl: string },
  cfg: MetaFbConfig = readMetaFbEnv() ?? throwUnconfigured(),
): Promise<string> {
  const startResult = await call<{ video_id: string }>(
    `${cfg.pageId}/video_stories`,
    cfg,
    {
      method: "POST",
      params: {
        upload_phase: "start",
        file_url: args.videoUrl,
      },
    },
  )

  if (!startResult?.video_id) {
    throw new MetaFbError(
      "FB video_stories start returned no video_id",
      502,
    )
  }

  await pollFbVideoUntilReady({ videoId: startResult.video_id }, cfg)

  const finishResult = await call<{ post_id?: string; success?: boolean }>(
    `${cfg.pageId}/video_stories`,
    cfg,
    {
      method: "POST",
      params: {
        upload_phase: "finish",
        video_id: startResult.video_id,
      },
    },
  )

  if (!finishResult?.post_id) {
    throw new MetaFbError(
      `FB video_stories finish returned no post_id (success=${finishResult?.success})`,
      502,
    )
  }

  return finishResult.post_id
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function throwUnconfigured(): never {
  throw new MetaFbError(
    "Meta FB not configured: set META_PAGE_ACCESS_TOKEN + META_FB_PAGE_ID",
    500,
  )
}
