import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { FEED_POSTS_MODULE } from "../../../../modules/feed-posts"
import type FeedPostsModuleService from "../../../../modules/feed-posts/service"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** GET /admin/feed-posts/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const from = String(req.query.from ?? "")
  const to = String(req.query.to ?? "")
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    res.status(400).json({ ok: false, reason: "bad_range" })
    return
  }
  const feed = req.scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const feed_posts = await feed.listByDateRange(from, to)
  res.json({ feed_posts })
}
