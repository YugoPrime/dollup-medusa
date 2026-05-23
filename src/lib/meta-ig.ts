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
