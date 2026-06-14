import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { FEED_POSTS_MODULE } from "../../../modules/feed-posts"
import type FeedPostsModuleService from "../../../modules/feed-posts/service"
import { mauritiusToday } from "../../../lib/mauritius-date"
import {
  buildFeedPostForDate,
  publishFeedPostRow,
} from "../../../lib/feed-post-pipeline"

const DEFAULT_DEDUP_DAYS = 30

/** GET /admin/feed-posts — recent feed posts, newest first. */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const service = req.scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30))
  const rows = await service.listFeedPosts({}, { take: limit })
  const feed_posts = [...rows].sort((a, b) =>
    String(b.post_date).localeCompare(String(a.post_date)),
  )
  res.json({ feed_posts })
}

/**
 * POST /admin/feed-posts — "Publish now" button.
 * Body: { product_id?: string, date?: "YYYY-MM-DD" }
 * Builds today's (or the given date's) feed post — optionally forcing a
 * specific product — then publishes it immediately. Re-runnable: a manual
 * trigger overrides an existing row for that date.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const body = (req.body ?? {}) as { product_id?: unknown; date?: unknown }
  const productId =
    typeof body.product_id === "string" && body.product_id ? body.product_id : undefined
  const postDate =
    typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : mauritiusToday()
  const dedupDays = Number(process.env.FEED_DEDUP_DAYS) || DEFAULT_DEDUP_DAYS

  try {
    const built = await buildFeedPostForDate({
      scope: req.scope,
      postDate,
      dedupDays,
      productId,
      force: true,
    })
    if (!built.ok) {
      const status = built.reason === "exists" ? 409 : 422
      res.status(status).json({ ok: false, reason: built.reason })
      return
    }

    const result = await publishFeedPostRow({
      scope: req.scope,
      feedPostId: built.row.id,
    })
    res.status(result.ok ? 200 : 502).json({
      ok: result.ok,
      feed_post_id: built.row.id,
      product_id: built.product_id,
      image_count: built.row.image_urls.length,
      ig_media_id: result.ig_media_id ?? null,
      fb_post_id: result.fb_post_id ?? null,
      error: result.error ?? null,
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error)?.message ?? "publish failed" })
  }
}
