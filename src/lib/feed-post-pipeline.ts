import type { MedusaContainer } from "@medusajs/framework/types"

import { STORIES_MODULE } from "../modules/stories"
import type StoriesModuleService from "../modules/stories/service"
import { createMedusaProductSource } from "../modules/stories/product-source"
import { buildSnapshot, type ProductLike, type ProductSnapshot } from "../modules/stories/snapshot"
import {
  DEFAULT_WEIGHTING,
  pickWeightedProduct,
  type WeightingConfig,
} from "../modules/stories/picker-weighting"
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

function resolveWeighting(settings: {
  collection_boost?: number | null
  collection_boost_days?: number | null
}): WeightingConfig {
  return {
    collection_boost: settings.collection_boost ?? DEFAULT_WEIGHTING.collection_boost,
    collection_boost_days:
      settings.collection_boost_days ?? DEFAULT_WEIGHTING.collection_boost_days,
  }
}

/**
 * Picks one product for the day's feed post and persists a `planned` FeedPost
 * row (snapshot + ordered images + caption). Reuses the stories product source,
 * snapshot builder and newest-collection weighting so the feed favours the
 * current drop just like stories do.
 *
 * - Idempotent per `postDate` unless `force` is set: returns {ok:false,exists}.
 * - Dedup: products featured in a feed post within `dedupDays` are excluded.
 * - `productId` forces a specific product (used by the admin "publish now").
 */
export async function buildFeedPostForDate(args: {
  scope: Scope
  postDate: string
  dedupDays: number
  productId?: string
  force?: boolean
}): Promise<BuildFeedPostResult> {
  const { scope, postDate, dedupDays } = args
  const feed = scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const stories = scope.resolve<StoriesModuleService>(STORIES_MODULE)

  if (!args.force) {
    const existing = await feed.findByDate(postDate)
    if (existing && existing.status !== "failed") {
      return { ok: false, reason: "exists", existing }
    }
  }

  const productSource = createMedusaProductSource(scope)
  const settings = await stories.getSettings()
  const weighting = resolveWeighting(settings)
  const captionOpts = readFeedCaptionOptionsFromEnv()

  // Dedup: exclude products already featured in a feed post within the window
  // so the same product isn't re-posted repeatedly.
  const sinceDate = shiftIsoDate(postDate, -Math.max(0, dedupDays))
  const excluded = new Set(await feed.getRecentlyFeaturedProductIds(sinceDate))

  const pick = await pickFeedProduct({
    productSource,
    productId: args.productId,
    excluded,
    weighting,
  })
  if (!pick) return { ok: false, reason: "no_eligible_product" }

  const { product, snapshot, images } = pick
  if (images.length === 0) return { ok: false, reason: "no_images" }

  const caption = buildFeedCaption(snapshot, captionOpts)
  const row = await feed.createPlanned({
    post_date: postDate,
    product_id: product.id,
    product_snapshot: snapshot,
    image_urls: images,
    caption,
  })
  return { ok: true, row, product_id: product.id }
}

async function pickFeedProduct(args: {
  productSource: (filter: { category_id?: string }) => Promise<ProductLike[]>
  productId?: string
  excluded: Set<string>
  weighting: WeightingConfig
}): Promise<{ product: ProductLike; snapshot: ProductSnapshot; images: string[] } | null> {
  const all = await args.productSource({})

  // Forced product (admin publish-now for a specific item).
  if (args.productId) {
    const forced = all.find((p) => p.id === args.productId)
    if (!forced) return null
    const snapshot = buildSnapshot(forced)
    return { product: forced, snapshot, images: selectFeedImages(snapshot) }
  }

  const eligible = all.filter(
    (p) =>
      !args.excluded.has(p.id) &&
      p.variants.some((v) => v.inventory_quantity > 0),
  )

  // Weighted pick, re-rolling past products whose snapshot yields no usable
  // feed photo so we still land on something postable.
  const now = Date.now()
  const pool = [...eligible]
  while (pool.length > 0) {
    const candidate = pickWeightedProduct(pool, args.weighting, now)
    if (!candidate) break
    const idx = pool.indexOf(candidate)
    if (idx >= 0) pool.splice(idx, 1)
    const snapshot = buildSnapshot(candidate)
    const images = selectFeedImages(snapshot)
    if (images.length > 0) return { product: candidate, snapshot, images }
  }
  return null
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

/** Shifts a "YYYY-MM-DD" date by `days` (can be negative). UTC-safe. */
function shiftIsoDate(date: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
  return d.toISOString().slice(0, 10)
}
