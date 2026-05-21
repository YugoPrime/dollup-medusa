/**
 * Thin client for Meta's Facebook Page Stories content-publishing flow.
 * Covers video stories specifically using file_url mode (server-side fetch
 * of a public MP4 - our Stories are R2-hosted):
 *   POST /{page_id}/video_stories?upload_phase=start
 *     -> returns { video_id, upload_url }
 *   POST {upload_url} with Authorization + file_url headers
 *     -> tells Meta's video uploader where to fetch the MP4 from
 *   POST /{page_id}/video_stories?upload_phase=finish&video_id=<id>
 *     -> returns { post_id, success }
 *
 * The middle upload_url request is REQUIRED. Passing file_url to the start
 * request only creates a video shell; Meta never receives the upload and the
 * video can sit in "processing" until finish fails with "Video Upload Is
 * Missing".
 *
 * No retries here - the caller (publish-story-slot) is the retry layer
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
  /**
   * Meta-provided human-readable error description. Often more useful than
   * the generic top-level `message`, for example on video rejection.
   */
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
  const json = await readJson(res)
  if (!res.ok) {
    throwFromMetaResponse(json, res.status, `Meta FB API ${res.status}`)
  }
  return json as T
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function throwFromMetaResponse(
  json: any,
  status: number,
  fallbackMessage: string,
): never {
  const err = json?.error
  throw new MetaFbError(
    err?.message ?? json?.message ?? fallbackMessage,
    status,
    {
      fbtraceId: err?.fbtrace_id,
      code: err?.code,
      subcode: err?.error_subcode,
      errorUserMsg: err?.error_user_msg,
      errorUserTitle: err?.error_user_title,
    },
  )
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
  // Diagnostic helper only. The normal Page Stories publish flow uses
  // start -> upload_url -> finish; it does not wait for this status to become
  // ready before issuing finish.
  const timeoutMs = args.timeoutMs ?? 900_000
  const pollIntervalMs = args.pollIntervalMs ?? 10_000
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
 * Three-request publish:
 *   start                   -> video_id + upload_url
 *   upload_url (file_url)   -> uploader accepts the public MP4 URL
 *   finish (video_id)       -> post_id
 * Returns the FB post_id on success, throws MetaFbError on any failure.
 */
export async function publishFbVideoStory(
  args: { videoUrl: string },
  cfg: MetaFbConfig = readMetaFbEnv() ?? throwUnconfigured(),
): Promise<string> {
  const startResult = await call<{ video_id?: string; upload_url?: string }>(
    `${cfg.pageId}/video_stories`,
    cfg,
    {
      method: "POST",
      params: {
        upload_phase: "start",
      },
    },
  )

  if (!startResult?.video_id) {
    throw new MetaFbError(
      "FB video_stories start returned no video_id",
      502,
    )
  }
  if (!startResult.upload_url) {
    throw new MetaFbError(
      "FB video_stories start returned no upload_url",
      502,
    )
  }

  await uploadFbVideoStorySource(
    {
      uploadUrl: startResult.upload_url,
      videoUrl: args.videoUrl,
      videoId: startResult.video_id,
    },
    cfg,
  )

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

async function uploadFbVideoStorySource(
  args: { uploadUrl: string; videoUrl: string; videoId: string },
  cfg: MetaFbConfig,
): Promise<void> {
  const res = await fetch(args.uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${cfg.pageAccessToken}`,
      file_url: args.videoUrl,
    },
  })
  const json = await readJson(res)

  if (!res.ok) {
    throwFromMetaResponse(
      json,
      res.status,
      `FB video_stories upload failed for video ${args.videoId}`,
    )
  }

  if (json?.success === false || json?.status?.video_status === "error") {
    const err = json?.error
    throw new MetaFbError(
      err?.message ??
        `FB video_stories upload was not accepted for video ${args.videoId}`,
      502,
      {
        fbtraceId: err?.fbtrace_id,
        code: err?.code,
        subcode: err?.error_subcode,
        errorUserMsg: err?.error_user_msg,
        errorUserTitle: err?.error_user_title,
      },
    )
  }
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
