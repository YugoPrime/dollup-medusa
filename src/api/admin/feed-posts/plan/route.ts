import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { FEED_POSTS_MODULE } from "../../../../modules/feed-posts"
import type FeedPostsModuleService from "../../../../modules/feed-posts/service"
import { mauritiusToday } from "../../../../lib/mauritius-date"
import { planFeedPostForDate } from "../../../../lib/feed-planner"
import { planGridPostForDate } from "../../../../lib/grid-planner"

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** POST /admin/feed-posts/plan { date, product_id } — schedule (no publish). */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as { date?: unknown; product_id?: unknown }
  const date = typeof body.date === "string" ? body.date : ""
  const productId = typeof body.product_id === "string" ? body.product_id : ""
  if (!DATE_RE.test(date) || !productId) {
    // `message` mirrors `reason` so clients using @medusajs/js-sdk (which
    // surfaces only the body's `message` on a thrown FetchError) can recover it.
    res.status(400).json({ ok: false, reason: "bad_input", message: "bad_input" })
    return
  }
  const result = await planFeedPostForDate({
    scope: req.scope,
    postDate: date,
    productId,
    today: mauritiusToday(),
  })
  if (!result.ok) {
    const status = result.reason === "posted" ? 409 : 422
    // `message` mirrors `reason` so SDK clients can recover the specific reason
    // (the js-sdk FetchError exposes only the body's `message`, not `reason`).
    res.status(status).json({ ok: false, reason: result.reason, message: result.reason })
    return
  }
  res.json({ ok: true, feed_post: result.row })
}

/**
 * DELETE /admin/feed-posts/plan { date } — the Feed Planner's "Replace".
 * Removes the planned row; for today or a future day it immediately plans a
 * replacement (never the removed product), so every upcoming day keeps a
 * preview. Past dates are only deleted.
 */
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
  const existing = await feed.findByDate(date)
  const removedProductId =
    existing && existing.status === "planned" ? existing.product_id : null
  const deleted = await feed.deletePlannedByDate(date)
  if (date < mauritiusToday() || deleted === 0) {
    res.json({ ok: true, deleted, feed_post: null })
    return
  }
  const replacement = await planGridPostForDate({
    scope: req.scope,
    postDate: date,
    excludeProductIds: removedProductId ? [removedProductId] : [],
  })
  res.json({ ok: true, deleted, feed_post: replacement.ok ? replacement.row : null })
}
