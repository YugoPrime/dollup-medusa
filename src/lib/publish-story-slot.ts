import type { MedusaContainer } from "@medusajs/framework/types"

import {
  MetaIgError,
  isMetaIgConfigured,
  publishContainer,
  pollContainerUntilReady,
  submitStoryContainer,
} from "./meta-ig"
import { STORIES_MODULE } from "../modules/stories"
import type StoriesModuleService from "../modules/stories/service"

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
    await stories.updateSlotMetadata(args.slotId, {
      publish: {
        media_id: mediaId,
        creation_id: creationId,
        published_at: new Date().toISOString(),
      },
      // Clear any previous failure annotation now that the slot succeeded.
      publish_error: null,
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
