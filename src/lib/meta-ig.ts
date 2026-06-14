/**
 * Thin client for Meta's Instagram Graph API content-publishing flow.
 * Covers Stories specifically: POST /{ig_user}/media (container) → poll
 * /{creation_id}?fields=status_code → POST /{ig_user}/media_publish.
 *
 * No retries here — the caller (publish cron) is the retry layer.
 */

export type MetaIgConfig = {
  igUserId: string
  pageAccessToken: string
  apiVersion: string
}

export type ContainerStatusCode =
  | "IN_PROGRESS"
  | "FINISHED"
  | "ERROR"
  | "EXPIRED"
  | "PUBLISHED"

export class MetaIgError extends Error {
  name = "MetaIgError"
  status: number
  fbtraceId?: string
  /** When set, surface this as user-facing detail in the cron alert. */
  metaErrorCode?: number
  metaErrorSubcode?: number
  constructor(
    message: string,
    status: number,
    extras: { fbtraceId?: string; code?: number; subcode?: number } = {},
  ) {
    super(message)
    this.status = status
    this.fbtraceId = extras.fbtraceId
    this.metaErrorCode = extras.code
    this.metaErrorSubcode = extras.subcode
  }
}

export function readMetaIgEnv(): MetaIgConfig | null {
  const pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN
  const igUserId = process.env.META_IG_BUSINESS_ACCOUNT_ID
  const apiVersion = process.env.META_API_VERSION ?? "v21.0"
  if (!pageAccessToken || !igUserId) return null
  return { pageAccessToken, igUserId, apiVersion }
}

export function isMetaIgConfigured(): boolean {
  return readMetaIgEnv() != null
}

function buildUrl(path: string, cfg: MetaIgConfig): URL {
  const cleaned = path.replace(/^\//, "")
  const url = new URL(`https://graph.facebook.com/${cfg.apiVersion}/${cleaned}`)
  url.searchParams.set("access_token", cfg.pageAccessToken)
  return url
}

async function call<T>(
  path: string,
  cfg: MetaIgConfig,
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
    throw new MetaIgError(
      err?.message ?? `Meta API ${res.status}`,
      res.status,
      {
        fbtraceId: err?.fbtrace_id,
        code: err?.code,
        subcode: err?.error_subcode,
      },
    )
  }
  return json as T
}

/**
 * Creates the Stories media container. Stories don't accept captions via the
 * API — captions stay a manual copy/paste flow for cross-posting to feed/reels.
 */
export async function submitStoryContainer(
  args: { videoUrl: string },
  cfg: MetaIgConfig = readMetaIgEnv() ?? throwUnconfigured(),
): Promise<string> {
  const result = await call<{ id: string }>(
    `${cfg.igUserId}/media`,
    cfg,
    {
      method: "POST",
      params: {
        media_type: "STORIES",
        video_url: args.videoUrl,
      },
    },
  )
  return result.id
}

/**
 * Creates an image media container for a FEED post (not a story). Used both for
 * single-image posts (with caption) and as a carousel child (is_carousel_item).
 * Returns the container creation_id. Instagram requires the image to be a
 * publicly reachable JPEG.
 */
export async function submitImageContainer(
  args: { imageUrl: string; caption?: string; isCarouselItem?: boolean },
  cfg: MetaIgConfig = readMetaIgEnv() ?? throwUnconfigured(),
): Promise<string> {
  const params: Record<string, string> = { image_url: args.imageUrl }
  if (args.isCarouselItem) params.is_carousel_item = "true"
  if (args.caption != null) params.caption = args.caption
  const result = await call<{ id: string }>(`${cfg.igUserId}/media`, cfg, {
    method: "POST",
    params,
  })
  return result.id
}

/**
 * Creates a CAROUSEL parent container from already-created child container ids
 * (2–10). The caption lives on the parent. Returns the parent creation_id.
 */
export async function submitCarouselContainer(
  args: { childrenIds: string[]; caption?: string },
  cfg: MetaIgConfig = readMetaIgEnv() ?? throwUnconfigured(),
): Promise<string> {
  if (args.childrenIds.length < 2) {
    throw new MetaIgError(
      "Carousel needs at least 2 children; use submitImageContainer for a single image",
      400,
    )
  }
  const params: Record<string, string> = {
    media_type: "CAROUSEL",
    children: args.childrenIds.join(","),
  }
  if (args.caption != null) params.caption = args.caption
  const result = await call<{ id: string }>(`${cfg.igUserId}/media`, cfg, {
    method: "POST",
    params,
  })
  return result.id
}

/**
 * High-level: publish a single image OR a carousel of images to the IG feed.
 * Builds child containers as needed, waits for processing, then publishes.
 * Returns the published media id.
 */
export async function publishFeedImages(
  args: { imageUrls: string[]; caption: string },
  cfg: MetaIgConfig = readMetaIgEnv() ?? throwUnconfigured(),
): Promise<string> {
  const urls = args.imageUrls.filter((u) => typeof u === "string" && u.length > 0)
  if (urls.length === 0) {
    throw new MetaIgError("No image URLs to publish", 400)
  }

  let creationId: string
  if (urls.length === 1) {
    creationId = await submitImageContainer(
      { imageUrl: urls[0], caption: args.caption },
      cfg,
    )
  } else {
    const childrenIds: string[] = []
    for (const url of urls.slice(0, 10)) {
      childrenIds.push(
        await submitImageContainer({ imageUrl: url, isCarouselItem: true }, cfg),
      )
    }
    creationId = await submitCarouselContainer(
      { childrenIds, caption: args.caption },
      cfg,
    )
  }

  // Image containers normally process in a second or two, but the container can
  // briefly report IN_PROGRESS — reuse the story poller (short timeout).
  await pollContainerUntilReady(
    { creationId, timeoutMs: 60_000, pollIntervalMs: 2000 },
    cfg,
  )
  return publishContainer({ creationId }, cfg)
}

export async function getContainerStatus(
  creationId: string,
  cfg: MetaIgConfig = readMetaIgEnv() ?? throwUnconfigured(),
): Promise<{ status_code: ContainerStatusCode }> {
  return call(`${creationId}`, cfg, {
    method: "GET",
    params: { fields: "status_code" },
  })
}

/**
 * Polls the container until status_code === FINISHED or a terminal error.
 * Stories video processing typically resolves in ~10-30s.
 */
export async function pollContainerUntilReady(
  args: {
    creationId: string
    timeoutMs?: number
    pollIntervalMs?: number
    statusUnavailableFallbackMs?: number
  },
  cfg: MetaIgConfig = readMetaIgEnv() ?? throwUnconfigured(),
): Promise<void> {
  const timeoutMs = args.timeoutMs ?? 90_000
  const pollIntervalMs = args.pollIntervalMs ?? 3000
  const statusUnavailableFallbackMs =
    args.statusUnavailableFallbackMs ?? Math.min(60_000, timeoutMs)
  const startedAt = Date.now()
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    let status_code: ContainerStatusCode
    try {
      ;({ status_code } = await getContainerStatus(args.creationId, cfg))
    } catch (err) {
      if (
        err instanceof MetaIgError &&
        isContainerStatusVisibilityError(err) &&
        Date.now() - startedAt >= statusUnavailableFallbackMs
      ) {
        // Meta sometimes accepts a freshly-created IG Story container, then
        // returns code 100/subcode 33 when reading that same container status.
        // After a conservative wait, let media_publish be authoritative.
        return
      }
      if (err instanceof MetaIgError && isContainerStatusVisibilityError(err)) {
        await sleep(pollIntervalMs)
        continue
      }
      throw err
    }
    if (status_code === "FINISHED" || status_code === "PUBLISHED") return
    if (status_code === "ERROR") {
      throw new MetaIgError(
        `Container ${args.creationId} processing failed (status=ERROR)`,
        500,
      )
    }
    if (status_code === "EXPIRED") {
      throw new MetaIgError(
        `Container ${args.creationId} expired before publish`,
        410,
      )
    }
    await sleep(pollIntervalMs)
  }
  throw new MetaIgError(
    `Container ${args.creationId} did not finish within ${timeoutMs}ms`,
    504,
  )
}

export function isContainerStatusVisibilityError(err: MetaIgError): boolean {
  return err.metaErrorCode === 100 && err.metaErrorSubcode === 33
}

export async function publishContainer(
  args: { creationId: string },
  cfg: MetaIgConfig = readMetaIgEnv() ?? throwUnconfigured(),
): Promise<string> {
  const result = await call<{ id: string }>(
    `${cfg.igUserId}/media_publish`,
    cfg,
    {
      method: "POST",
      params: { creation_id: args.creationId },
    },
  )
  return result.id
}

function throwUnconfigured(): never {
  throw new MetaIgError(
    "Meta IG not configured: set META_PAGE_ACCESS_TOKEN + META_IG_BUSINESS_ACCOUNT_ID",
    500,
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Inspect the Page Access Token via Meta's /debug_token endpoint.
 * Returns `expires_at` as a unix seconds timestamp — 0 means "never expires"
 * (the long-lived Page token issued after the user token swap typically
 * reports 0 OR a real ~60-day expiry depending on how it was minted).
 *
 * Requires META_APP_ID + META_APP_SECRET so we can build an app access token
 * (`app_id|app_secret`). Without those we can't call debug_token reliably —
 * returns `null` and lets the caller decide what to do.
 */
export type TokenInfo = {
  /** Unix seconds. 0 = never expires (long-lived page token). */
  expires_at: number
  /** Unix seconds. When the user_access_token underlying this page token expires. */
  data_access_expires_at?: number
  is_valid: boolean
  scopes?: string[]
  type?: string
  app_id?: string
}

// Public Meta App ID for "DOLL UP OS". Not a secret — exposed in the Pixel
// snippet and every Graph API URL. Kept as a default so the cron works with
// only META_APP_SECRET in Coolify (matches setup-meta-token.mjs).
const DEFAULT_META_APP_ID = "1396051052286039"

export async function inspectPageAccessToken(
  cfg: MetaIgConfig = readMetaIgEnv() ?? throwUnconfigured(),
): Promise<TokenInfo | null> {
  const appId = process.env.META_APP_ID ?? DEFAULT_META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) return null

  const url = new URL(`https://graph.facebook.com/${cfg.apiVersion}/debug_token`)
  url.searchParams.set("input_token", cfg.pageAccessToken)
  url.searchParams.set("access_token", `${appId}|${appSecret}`)

  const res = await fetch(url, { method: "GET" })
  let json: any = null
  try {
    json = await res.json()
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = json?.error
    throw new MetaIgError(
      err?.message ?? `debug_token ${res.status}`,
      res.status,
      { fbtraceId: err?.fbtrace_id, code: err?.code, subcode: err?.error_subcode },
    )
  }
  const d = json?.data
  if (!d) return null
  return {
    expires_at: typeof d.expires_at === "number" ? d.expires_at : 0,
    data_access_expires_at:
      typeof d.data_access_expires_at === "number" ? d.data_access_expires_at : undefined,
    is_valid: d.is_valid === true,
    scopes: Array.isArray(d.scopes) ? d.scopes : undefined,
    type: typeof d.type === "string" ? d.type : undefined,
    app_id: typeof d.app_id === "string" ? d.app_id : undefined,
  }
}
