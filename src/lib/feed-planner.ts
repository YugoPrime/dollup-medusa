import type { FeedPostStatus } from "../modules/feed-posts/service"
import type { MedusaContainer } from "@medusajs/framework/types"
import { FEED_POSTS_MODULE } from "../modules/feed-posts"
import type FeedPostsModuleService from "../modules/feed-posts/service"
import type { FeedPostDTO } from "../modules/feed-posts/service"
import { buildFeedPostForDate } from "./feed-post-pipeline"
import {
  loadGridProduct,
  rotationCategorySets,
  storyProductIdsForDate,
} from "./grid-planner"
import { rotationKeyForProduct } from "./grid-rotation"

/** A failed grid post is retried until it has been attempted this many times. */
export const FEED_MAX_ATTEMPTS = 3

export type DailyPublishAction = "publish_existing" | "auto_pick" | "skip"

/**
 * Decides what the daily cron should do for today given the existing FeedPost
 * row (if any) for today's MU date. A planned row is published; a failed one is
 * retried until FEED_MAX_ATTEMPTS; an empty day is auto-picked; a
 * posted/skipped day is left alone.
 */
export function decideDailyPublishAction(
  existing: { status: FeedPostStatus; attempt_count?: number | null } | null,
): DailyPublishAction {
  if (!existing) return "auto_pick"
  switch (existing.status) {
    case "planned":
      return "publish_existing"
    case "failed":
      return (existing.attempt_count ?? 0) < FEED_MAX_ATTEMPTS ? "publish_existing" : "skip"
    case "posted":
    case "skipped":
      return "skip"
  }
}

export type PlanResult =
  | { ok: true; row: FeedPostDTO }
  | {
      ok: false
      reason: "posted" | "past" | "not_published" | "no_images" | "not_allowed" | "in_stories"
    }

/**
 * Schedules a specific product as the feed post for `postDate` without
 * publishing. Replaces any existing *planned* row for that date; refuses dates
 * in the past or already posted, products that can't go on social, and
 * products already in that day's stories. The row records the product's
 * rotation category (null outside dresses/lingerie/beachwear) so the rotation
 * continues from the owner's choice. Builds the full snapshot+images+caption
 * via the shared pipeline (forced product), so the daily cron can publish it
 * verbatim at 18:00 MU.
 */
export async function planFeedPostForDate(args: {
  scope: MedusaContainer
  postDate: string
  productId: string
  today: string
}): Promise<PlanResult> {
  const { scope, postDate, productId, today } = args
  if (postDate < today) return { ok: false, reason: "past" }

  const feed = scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const existing = await feed.findByDate(postDate)
  // A failed row is still being retried (or has given up) for that day; only
  // one row per day can exist.
  if (existing && (existing.status === "posted" || existing.status === "failed")) {
    return { ok: false, reason: "posted" }
  }

  // Same safety rules as the automatic pick: never a product that can't go on
  // social, never one already in that day's stories.
  const loaded = await loadGridProduct(scope, productId)
  if (!loaded.product || !loaded.published) return { ok: false, reason: "not_published" }
  if (loaded.socialExcluded) return { ok: false, reason: "not_allowed" }
  if ((await storyProductIdsForDate(scope, postDate)).includes(productId)) {
    return { ok: false, reason: "in_stories" }
  }

  await feed.deletePlannedByDate(postDate)

  const rotation = rotationKeyForProduct(
    loaded.product.category_ids ?? [],
    await rotationCategorySets(scope),
  )
  const built = await buildFeedPostForDate({
    scope,
    postDate,
    productId,
    force: true,
    metadata: { rotation_category: rotation, auto: false },
  })
  if (!built.ok) {
    // forced product not in the published source → treat as not-published
    const reason = built.reason === "no_images" ? "no_images" : "not_published"
    return { ok: false, reason }
  }
  return { ok: true, row: built.row }
}
