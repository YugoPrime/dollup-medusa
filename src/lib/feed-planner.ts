import type { FeedPostStatus } from "../modules/feed-posts/service"

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
