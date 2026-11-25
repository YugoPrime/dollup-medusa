import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { FEED_POSTS_MODULE } from "../../../../../modules/feed-posts"
import type FeedPostsModuleService from "../../../../../modules/feed-posts/service"
import type { FeedPostDTO } from "../../../../../modules/feed-posts/service"
import { previewFeedRow } from "../../../../../lib/feed-row-preview"

/**
 * GET /admin/feed-posts/:id/preview — the Feed Planner's "as it will post"
 * view: every photo drawn with its size row, at half size.
 *
 * A post that hasn't gone out yet is shown from the live product (price,
 * sizes, remaining reviewed photos), exactly as the 18:00 publish refreshes
 * it (`live: true`); a posted one, or one whose product can't be refreshed,
 * from the row as stored. The drawing is shared with the evening Telegram
 * preview (src/lib/feed-row-preview.ts).
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const feed = req.scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const [row] = (await feed.listFeedPosts({ id: req.params.id })) as unknown as FeedPostDTO[]
  if (!row) {
    res.status(404).json({ message: "Feed post not found" })
    return
  }

  const { images, live } = await previewFeedRow(req.scope, row)
  res.json({ images, live })
}
