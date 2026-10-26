import { FEED_POSTS_MODULE } from "../modules/feed-posts"
import type FeedPostsModuleService from "../modules/feed-posts/service"
import { createMedusaProductSource } from "../modules/stories/product-source"
import type { PickDeps } from "../modules/stories/service"

/**
 * Everything the story picker needs from outside the stories module: the
 * shared product source and that day's grid-post product, which stories must
 * never repeat. Used by every caller of regeneratePlan / createBatchPlans.
 */
export function createStoryPickDeps(scope: { resolve(key: any): any }): Required<PickDeps> {
  return {
    productSource: createMedusaProductSource(scope),
    gridProductIdsForDate: (date) => gridProductIdsForDate(scope, date),
  }
}

/** Product id of the grid post planned/posted/failed for `date`, if any. */
export async function gridProductIdsForDate(
  scope: { resolve(key: any): any },
  date: string,
): Promise<string[]> {
  const feed = scope.resolve(FEED_POSTS_MODULE) as FeedPostsModuleService
  const row = await feed.findByDate(date)
  if (!row?.product_id) return []
  return row.status === "planned" || row.status === "posted" || row.status === "failed"
    ? [row.product_id]
    : []
}
