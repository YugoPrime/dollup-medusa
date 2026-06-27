import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { FEED_POSTS_MODULE } from "../../../../modules/feed-posts"
import type FeedPostsModuleService from "../../../../modules/feed-posts/service"
import { mauritiusToday } from "../../../../lib/mauritius-date"
import { planFeedPostForDate } from "../../../../lib/feed-planner"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DEFAULT_DEDUP_DAYS = 30

/** POST /admin/feed-posts/plan { date, product_id } — schedule (no publish). */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as { date?: unknown; product_id?: unknown }
  const date = typeof body.date === "string" ? body.date : ""
  const productId = typeof body.product_id === "string" ? body.product_id : ""
  if (!DATE_RE.test(date) || !productId) {
    res.status(400).json({ ok: false, reason: "bad_input" })
    return
  }
  const dedupDays = Number(process.env.FEED_DEDUP_DAYS) || DEFAULT_DEDUP_DAYS
  const result = await planFeedPostForDate({
    scope: req.scope,
    postDate: date,
    productId,
    today: mauritiusToday(),
    dedupDays,
  })
  if (!result.ok) {
    const status = result.reason === "posted" ? 409 : 422
    res.status(status).json({ ok: false, reason: result.reason })
    return
  }
  res.json({ ok: true, feed_post: result.row })
}

/** DELETE /admin/feed-posts/plan { date } — unschedule (remove planned row). */
export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as { date?: unknown }
  const date =
    (typeof body.date === "string" && body.date) ||
    (typeof req.query.date === "string" ? req.query.date : "")
  if (!DATE_RE.test(date)) {
    res.status(400).json({ ok: false, reason: "bad_input" })
    return
  }
  const feed = req.scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const deleted = await feed.deletePlannedByDate(date)
  res.json({ ok: true, deleted })
}
