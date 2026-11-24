import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { FEED_POSTS_MODULE } from "../../../../../modules/feed-posts"
import type FeedPostsModuleService from "../../../../../modules/feed-posts/service"
import type { FeedPostDTO } from "../../../../../modules/feed-posts/service"
import { buildFeedPreviewImages } from "../../../../../lib/feed-preview"
import { loadGridProduct } from "../../../../../lib/grid-planner"
import { refreshGridContent } from "../../../../../lib/grid-rotation"

/**
 * GET /admin/feed-posts/:id/preview — the Feed Planner's "as it will post"
 * view: every photo drawn with its size row, at half size.
 *
 * A post that hasn't gone out yet is shown from the live product (price,
 * sizes, remaining reviewed photos), exactly as the 18:00 publish refreshes
 * it (`live: true`); a posted one, or one whose product can't be refreshed,
 * from the row as stored.
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const feed = req.scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const [row] = (await feed.listFeedPosts({ id: req.params.id })) as unknown as FeedPostDTO[]
  if (!row) {
    res.status(404).json({ message: "Feed post not found" })
    return
  }

  let imageUrls = Array.isArray(row.image_urls) ? (row.image_urls as string[]) : []
  let snapshot: unknown = row.product_snapshot
  let live = false
  if (row.status !== "posted" && row.product_id) {
    const { product } = await loadGridProduct(req.scope, row.product_id)
    const refreshed = product ? refreshGridContent(imageUrls, product) : null
    if (refreshed) {
      imageUrls = refreshed.image_urls
      snapshot = refreshed.product_snapshot
      live = true
    }
  }

  res.json({ images: await buildFeedPreviewImages({ imageUrls, snapshot }), live })
}
