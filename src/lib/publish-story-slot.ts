import type { MedusaContainer } from "@medusajs/framework/types"

import {
  MetaIgError,
  isMetaIgConfigured,
  publishContainer,
  pollContainerUntilReady,
  submitStoryContainer,
} from "./meta-ig"
import {
  MetaFbError,
  isFbCrosspostEnabled,
  publishFbVideoStory,
} from "./meta-fb"
import { STORIES_MODULE } from "../modules/stories"
import type StoriesModuleService from "../modules/stories/service"

type FbPublishErrorRecord = {
  message: string
  status?: number
  fbtrace_id?: string
  meta_code?: number
  attempted_at: string
}

export type PublishSuccess = {
  ok: true
  media_id: string
  creation_id: string
  duration_ms: number
}

export type PublishFailure = {
  ok: false
  error: string
  status?: number
  fbtrace_id?: string
  meta_code?: number
  attempt_count: number
}

export type PublishResult = PublishSuccess | PublishFailure

/**
 * One slot → IG Stories. Submits the rendered MP4 as a container, polls
 * until processing finishes, then publishes. On success: stories.markPosted
 * writes the publication_log row + flips plan status, and we annotate
 * slot.metadata.publish with the Meta IDs. On failure we annotate
 * slot.metadata.publish_error with the attempt count + last error so the
 * cron can back off and the admin UI can surface what went wrong.
 *
 * Safe to call manually (from a "Publish now" admin button) or on a schedule
 * (from publish-due-stories.ts). Idempotent against already-posted slots.
 */
export async function publishStorySlot(args: {
  scope: MedusaContainer
  slotId: string
}): Promise<PublishResult> {
  const startedAt = Date.now()
  const stories = args.scope.resolve<StoriesModuleService>(STORIES_MODULE)

  const [slot] = await stories.listStorySlots({ id: args.slotId })
  if (!slot) {
    return {
      ok: false,
      error: `Slot ${args.slotId} not found`,
      attempt_count: 0,
    }
  }
  if (slot.posted_at) {
    return {
      ok: false,
      error: "Slot already posted",
      attempt_count: readAttemptCount(slot.metadata),
    }
  }

  const render = readRender(slot.metadata)
  if (!render) {
    return {
      ok: false,
      error: "Slot has no rendered MP4 yet",
      attempt_count: readAttemptCount(slot.metadata),
    }
  }

  if (!isMetaIgConfigured()) {
    return {
      ok: false,
      error: "Meta IG credentials not configured",
      attempt_count: readAttemptCount(slot.metadata),
    }
  }

  const previousAttempts = readAttemptCount(slot.metadata)

  try {
    const creationId = await submitStoryContainer({ videoUrl: render.mp4_url })
    await pollContainerUntilReady({ creationId })
    const mediaId = await publishContainer({ creationId })

    await stories.markPosted(args.slotId)

    let fbStoryId: string | undefined
    let fbPublishError: FbPublishErrorRecord | null = null

    if (isFbCrosspostEnabled()) {
      try {
        fbStoryId = await publishFbVideoStory({ videoUrl: render.mp4_url })
      } catch (fbErr) {
        const e = fbErr instanceof MetaFbError ? fbErr : null
        fbPublishError = {
          message: (fbErr as Error)?.message ?? "FB cross-post failed",
          status: e?.status,
          fbtrace_id: e?.fbtraceId,
          meta_code: e?.metaErrorCode,
          attempted_at: new Date().toISOString(),
        }
      }
    }

    // Build the publish block. fb_story_id is only set when we actually got
    // one this run — otherwise omit the key so updateSlotMetadata's shallow
    // merge doesn't wipe a prior crosspost ID. (Scenarios: FB crosspost is
    // currently disabled but was enabled on a previous successful publish,
    // OR this run's FB attempt failed — either way, keep the historic ID.)
    const priorFbStoryId = readPriorFbStoryId(slot.metadata)
    const publishBlock: Record<string, unknown> = {
      media_id: mediaId,
      creation_id: creationId,
      published_at: new Date().toISOString(),
    }
    if (fbStoryId) {
      publishBlock.fb_story_id = fbStoryId
    } else if (priorFbStoryId) {
      publishBlock.fb_story_id = priorFbStoryId
    }

    await stories.updateSlotMetadata(args.slotId, {
      publish: publishBlock,
      // Clear any previous IG failure annotation now that the slot succeeded.
      publish_error: null,
      // null clears any prior failure; record clears any prior success.
      fb_publish_error: fbPublishError,
    })

    return {
      ok: true,
      media_id: mediaId,
      creation_id: creationId,
      duration_ms: Date.now() - startedAt,
    }
  } catch (err) {
    const e = err instanceof MetaIgError ? err : null
    const message = (err as Error)?.message ?? "Publish failed"
    const attemptCount = previousAttempts + 1

    await stories.updateSlotMetadata(args.slotId, {
      publish_error: {
        message,
        status: e?.status,
        fbtrace_id: e?.fbtraceId,
        meta_code: e?.metaErrorCode,
        meta_subcode: e?.metaErrorSubcode,
        attempted_at: new Date().toISOString(),
        attempt_count: attemptCount,
      },
    })

    return {
      ok: false,
      error: message,
      status: e?.status,
      fbtrace_id: e?.fbtraceId,
      meta_code: e?.metaErrorCode,
      attempt_count: attemptCount,
    }
  }
}

/**
 * Returns slot.metadata.publish.fb_story_id when it's a non-empty string, else
 * null. Used by publishStorySlot to preserve a prior crosspost ID across a
 * re-publish when the current run didn't (or couldn't) cross-post to FB.
 */
export function readPriorFbStoryId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const p = (metadata as any).publish
  if (!p || typeof p !== "object") return null
  const id = p.fb_story_id
  return typeof id === "string" && id.length > 0 ? id : null
}

export function readRender(
  metadata: unknown,
): { template_slug: string; mp4_url: string } | null {
  if (!metadata || typeof metadata !== "object") return null
  const m = metadata as Record<string, unknown>
  const render = m.render
  if (!render || typeof render !== "object") return null
  const r = render as Record<string, unknown>
  if (typeof r.template_slug !== "string") return null
  if (typeof r.mp4_url !== "string") return null
  return { template_slug: r.template_slug, mp4_url: r.mp4_url }
}

export function readAttemptCount(metadata: unknown): number {
  if (!metadata || typeof metadata !== "object") return 0
  const e = (metadata as any).publish_error
  if (!e || typeof e !== "object") return 0
  const n = Number(e.attempt_count ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function readLastAttemptAt(metadata: unknown): Date | null {
  if (!metadata || typeof metadata !== "object") return null
  const e = (metadata as any).publish_error
  if (!e || typeof e !== "object") return null
  const at = e.attempted_at
  if (typeof at !== "string") return null
  const d = new Date(at)
  return Number.isFinite(d.getTime()) ? d : null
}

export function readFbPublishError(
  metadata: unknown,
): FbPublishErrorRecord | null {
  if (!metadata || typeof metadata !== "object") return null
  const e = (metadata as any).fb_publish_error
  if (!e || typeof e !== "object") return null
  if (typeof e.message !== "string") return null
  return {
    message: e.message,
    status: typeof e.status === "number" ? e.status : undefined,
    fbtrace_id: typeof e.fbtrace_id === "string" ? e.fbtrace_id : undefined,
    meta_code: typeof e.meta_code === "number" ? e.meta_code : undefined,
    attempted_at:
      typeof e.attempted_at === "string" ? e.attempted_at : "",
  }
}
