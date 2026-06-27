import type { FeedPostStatus } from "../modules/feed-posts/service"
import type { MedusaContainer } from "@medusajs/framework/types"
import { FEED_POSTS_MODULE } from "../modules/feed-posts"
import type FeedPostsModuleService from "../modules/feed-posts/service"
import type { FeedPostDTO } from "../modules/feed-posts/service"
import { buildFeedPostForDate } from "./feed-post-pipeline"

export type DailyPublishAction = "publish_existing" | "auto_pick" | "skip"

/**
 * Decides what the daily cron should do for today given the existing FeedPost
 * row (if any) for today's MU date. A pre-planned row from the Feed Planner is
 * published; an empty day is auto-picked; a posted/skipped day is left alone.
 */
export function decideDailyPublishAction(
  existing: { status: FeedPostStatus } | null,
): DailyPublishAction {
  if (!existing) return "auto_pick"
  switch (existing.status) {
    case "planned":
    case "failed":
      return "publish_existing"
    case "posted":
    case "skipped":
      return "skip"
  }
}

export type PlanResult =
  | { ok: true; row: FeedPostDTO }
  | { ok: false; reason: "posted" | "past" | "not_published" | "no_images" }

/**
 * Schedules a specific product as the feed post for `postDate` without
 * publishing. Replaces any existing *planned* row for that date; refuses dates
 * in the past or dates already posted. Builds the full snapshot+images+caption
 * via the shared pipeline (forced product), so the daily cron can publish it
 * verbatim at 18:00 MU.
 */
export async function planFeedPostForDate(args: {
  scope: MedusaContainer
  postDate: string
  productId: string
  today: string
  dedupDays: number
}): Promise<PlanResult> {
  const { scope, postDate, productId, today, dedupDays } = args
  if (postDate < today) return { ok: false, reason: "past" }

  const feed = scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const existing = await feed.findByDate(postDate)
  if (existing && existing.status === "posted") {
    return { ok: false, reason: "posted" }
  }

  await feed.deletePlannedByDate(postDate)

  const built = await buildFeedPostForDate({
    scope,
    postDate,
    dedupDays,
    productId,
    force: true,
  })
  if (!built.ok) {
    // forced product not in the published source → treat as not-published
    const reason = built.reason === "no_images" ? "no_images" : "not_published"
    return { ok: false, reason }
  }
  return { ok: true, row: built.row }
}
