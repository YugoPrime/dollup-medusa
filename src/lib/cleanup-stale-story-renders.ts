import type { MedusaContainer } from "@medusajs/framework/types"

import {
  deleteStoryRenders,
  listStoryRenders,
  parseSlotIdFromKey,
  type R2StoryObject,
} from "./r2-story-uploader"
import { STORIES_MODULE } from "../modules/stories"
import type StoriesModuleService from "../modules/stories/service"

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export type SlotSummary = {
  id: string
  posted_at: Date | null
  /** mp4_url currently referenced by the slot's metadata.render (the "live"
   *  MP4 for this slot). null when the slot has never been rendered. */
  current_mp4_url: string | null
}

export type CleanupDecision = {
  delete: R2StoryObject[]
  keep: R2StoryObject[]
  /** Per-key reason, mirrors decide()'s output. Useful for the Telegram
   *  summary so we know WHY we deleted each one. */
  reasons: Map<string, string>
}

/**
 * Pure function. Given the R2 inventory + a map of slot summaries, decides
 * which MP4s are safe to delete. Rules (the FIRST match wins):
 *
 *   1. Key isn't shaped `stories/<slotId>/<hash>.mp4` → DELETE (orphan key,
 *      probably from a manual upload or an old key scheme)
 *   2. Slot doesn't exist in DB → DELETE (slot was hard-deleted but its
 *      render lingered in R2)
 *   3. Slot has posted_at AND posted_at < now - 7 days → DELETE (story is
 *      well past IG/FB's 24h Story window; URL is no longer needed)
 *   4. MP4 is NOT the slot's currently-referenced mp4_url AND the MP4 is
 *      > 24h old → DELETE (stale re-render; the slot moved to a newer hash)
 *   5. Otherwise → KEEP (active or recent)
 *
 * The 24h grace on rule 4 protects against deleting an MP4 that was just
 * uploaded but hasn't yet been linked into slot.metadata.render due to a
 * crash between upload and metadata write.
 */
export function decideR2Cleanup(args: {
  inventory: R2StoryObject[]
  slotsById: Map<string, SlotSummary>
  now: Date
}): CleanupDecision {
  const { inventory, slotsById, now } = args
  const cutoffPosted = new Date(now.getTime() - SEVEN_DAYS_MS)
  const cutoffStale = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const decision: CleanupDecision = {
    delete: [],
    keep: [],
    reasons: new Map(),
  }

  for (const obj of inventory) {
    const slotId = parseSlotIdFromKey(obj.key)
    if (!slotId) {
      decision.delete.push(obj)
      decision.reasons.set(obj.key, "orphan-key (not stories/<slotId>/<hash>.mp4)")
      continue
    }

    const slot = slotsById.get(slotId)
    if (!slot) {
      decision.delete.push(obj)
      decision.reasons.set(obj.key, "slot-not-found-in-db")
      continue
    }

    if (slot.posted_at && slot.posted_at.getTime() < cutoffPosted.getTime()) {
      decision.delete.push(obj)
      decision.reasons.set(obj.key, "posted-over-7-days-ago")
      continue
    }

    const isCurrent =
      slot.current_mp4_url != null && slot.current_mp4_url.endsWith(obj.key)
    if (!isCurrent && obj.lastModified.getTime() < cutoffStale.getTime()) {
      decision.delete.push(obj)
      decision.reasons.set(obj.key, "stale-rerender (not slot's current MP4)")
      continue
    }

    decision.keep.push(obj)
  }

  return decision
}

/**
 * Runs the cleanup end-to-end:
 *   1. List every MP4 under `stories/` in R2
 *   2. Fetch a thin summary of every slot in the DB
 *   3. Apply decideR2Cleanup to figure out what to drop
 *   4. Issue batched DeleteObjects calls
 *   5. Return a summary suitable for logging or Telegram
 */
export async function runR2CleanupOnce(
  scope: MedusaContainer,
  opts: { now?: Date; dryRun?: boolean } = {},
): Promise<{
  scanned: number
  deleted: number
  kept: number
  bytes_freed: number
  errors: Array<{ key: string; message: string }>
  dry_run: boolean
}> {
  const now = opts.now ?? new Date()
  const dryRun = opts.dryRun === true

  const stories = scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const [inventory, allSlots] = await Promise.all([
    listStoryRenders(),
    stories.listStorySlots({}),
  ])

  const slotsById = new Map<string, SlotSummary>()
  for (const s of allSlots) {
    const meta = (s.metadata ?? null) as Record<string, unknown> | null
    const render =
      meta && typeof meta.render === "object"
        ? (meta.render as Record<string, unknown>)
        : null
    const currentMp4 =
      render && typeof render.mp4_url === "string" ? render.mp4_url : null
    slotsById.set(s.id, {
      id: s.id,
      posted_at: s.posted_at ? new Date(s.posted_at) : null,
      current_mp4_url: currentMp4,
    })
  }

  const decision = decideR2Cleanup({ inventory, slotsById, now })
  const bytesFreed = decision.delete.reduce((sum, o) => sum + o.size, 0)

  if (dryRun || decision.delete.length === 0) {
    return {
      scanned: inventory.length,
      deleted: 0,
      kept: decision.keep.length,
      bytes_freed: bytesFreed,
      errors: [],
      dry_run: dryRun,
    }
  }

  const { deleted, errors } = await deleteStoryRenders(
    decision.delete.map((o) => o.key),
  )

  return {
    scanned: inventory.length,
    deleted,
    kept: decision.keep.length,
    bytes_freed: bytesFreed,
    errors,
    dry_run: false,
  }
}
