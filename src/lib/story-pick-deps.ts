import { FEED_POSTS_MODULE } from "../modules/feed-posts"
import type FeedPostsModuleService from "../modules/feed-posts/service"
import { createMedusaProductSource } from "../modules/stories/product-source"
import { STORIES_MODULE } from "../modules/stories"
import type StoriesModuleService from "../modules/stories/service"
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

/**
 * Why a story can't be swapped to `productId` on a day whose grid post is
 * `gridIds`, or null. Same rule as the picker: never the day's grid product
 * (the grid would otherwise replace the owner's reviewed post at 18:00).
 */
export function gridSwapConflict(gridIds: string[], productId: string): string | null {
  return gridIds.includes(productId)
    ? "That product is this day's grid post — pick another for the story."
    : null
}

/** That day's grid product for the plan a story slot belongs to. */
export async function gridProductIdsForPlan(
  scope: { resolve(key: any): any },
  planId: string,
): Promise<string[]> {
  const stories = scope.resolve(STORIES_MODULE) as StoriesModuleService
  const [plan] = await stories.listStoryPlans({ id: planId })
  if (!plan) return []
  const pd = plan.plan_date as unknown as string | Date
  return gridProductIdsForDate(scope, typeof pd === "string" ? pd.slice(0, 10) : pd.toISOString().slice(0, 10))
}
