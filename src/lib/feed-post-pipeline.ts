import type { MedusaContainer } from "@medusajs/framework/types"

import { createMedusaProductSource } from "../modules/stories/product-source"
import { buildSnapshot } from "../modules/stories/snapshot"
import { FEED_POSTS_MODULE } from "../modules/feed-posts"
import type FeedPostsModuleService from "../modules/feed-posts/service"
import type { FeedPostDTO } from "../modules/feed-posts/service"
import {
  buildFeedCaption,
  readFeedCaptionOptionsFromEnv,
  selectFeedImages,
} from "./feed-post-content"
import { isMetaIgConfigured, publishFeedImages } from "./meta-ig"
import { isFeedFbCrosspostEnabled, publishFbPhotoPost } from "./meta-fb"

export type BuildFeedPostResult =
  | { ok: true; row: FeedPostDTO; product_id: string }
  | { ok: false; reason: "exists" | "no_eligible_product" | "no_images"; existing?: FeedPostDTO }

type Scope = MedusaContainer

/**
 * Persists a `planned` FeedPost row (snapshot + ordered images + caption) for
 * one specific product. Automatic picks go through grid-planner.ts
 * (planGridPostForDate); this only builds a row for a product the owner chose
 * (Feed Planner drag/swap or "publish now" with a product).
 *
 * - Idempotent per `postDate` unless `force` is set: returns {ok:false,exists}.
 * - Without `productId` there is nothing to build: {ok:false,no_eligible_product}.
 */
export async function buildFeedPostForDate(args: {
  scope: Scope
  postDate: string
  productId?: string
  force?: boolean
  metadata?: Record<string, unknown>
}): Promise<BuildFeedPostResult> {
  const { scope, postDate } = args
  const feed = scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)

  if (!args.force) {
    const existing = await feed.findByDate(postDate)
    if (existing && existing.status !== "failed") {
      return { ok: false, reason: "exists", existing }
    }
  }
  if (!args.productId) return { ok: false, reason: "no_eligible_product" }

  const all = await createMedusaProductSource(scope)({})
  const product = all.find((p) => p.id === args.productId)
  if (!product) return { ok: false, reason: "no_eligible_product" }

  const snapshot = buildSnapshot(product)
  const images = selectFeedImages(snapshot)
  if (images.length === 0) return { ok: false, reason: "no_images" }

  const row = await feed.createPlanned({
    post_date: postDate,
    product_id: product.id,
    product_snapshot: snapshot,
    image_urls: images,
    caption: buildFeedCaption(snapshot, readFeedCaptionOptionsFromEnv()),
    metadata: args.metadata ?? null,
  })
  return { ok: true, row, product_id: product.id }
}

export type PublishFeedPostResult = {
  ok: boolean
  ig_media_id?: string
  fb_post_id?: string
  error?: string
  attempt_count?: number
}

/**
 * Publishes a planned FeedPost row to IG (carousel/single image) and, when
 * FEED_CROSSPOST_FB=true, cross-posts to the FB Page feed (soft-fail). Marks
 * the row posted/failed accordingly.
 */
export async function publishFeedPostRow(args: {
  scope: Scope
  feedPostId: string
}): Promise<PublishFeedPostResult> {
  const feed = args.scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const [row] = (await feed.listFeedPosts({ id: args.feedPostId })) as unknown as FeedPostDTO[]
  if (!row) return { ok: false, error: `FeedPost ${args.feedPostId} not found` }
  if (row.status === "posted") {
    return { ok: true, ig_media_id: row.ig_media_id ?? undefined, fb_post_id: row.fb_post_id ?? undefined }
  }

  const images = Array.isArray(row.image_urls) ? (row.image_urls as string[]) : []
  const caption = row.caption ?? ""
  if (images.length === 0) {
    const attempts = await feed.markFailed(args.feedPostId, "no image_urls on row")
    return { ok: false, error: "no image_urls on row", attempt_count: attempts }
  }
  if (!isMetaIgConfigured()) {
    const attempts = await feed.markFailed(args.feedPostId, "Meta IG not configured")
    return { ok: false, error: "Meta IG not configured", attempt_count: attempts }
  }

  let igMediaId: string
  try {
    igMediaId = await publishFeedImages({ imageUrls: images, caption })
  } catch (err) {
    const message = (err as Error)?.message ?? "IG publish failed"
    const attempts = await feed.markFailed(args.feedPostId, message)
    return { ok: false, error: message, attempt_count: attempts }
  }

  // Optional FB cross-post — soft failure (IG success is authoritative).
  let fbPostId: string | undefined
  if (isFeedFbCrosspostEnabled()) {
    try {
      fbPostId = await publishFbPhotoPost({ imageUrls: images, caption })
    } catch {
      fbPostId = undefined
    }
  }

  await feed.markPosted(args.feedPostId, {
    ig_media_id: igMediaId,
    fb_post_id: fbPostId ?? null,
  })
  return { ok: true, ig_media_id: igMediaId, fb_post_id: fbPostId }
}
