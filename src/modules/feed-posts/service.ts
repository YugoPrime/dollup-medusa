import { MedusaService } from "@medusajs/framework/utils"

import FeedPost from "./models/feed-post"

export type FeedPostStatus = "planned" | "posted" | "failed" | "skipped"

export type FeedPostDTO = {
  id: string
  post_date: string
  product_id: string | null
  product_snapshot: unknown | null
  image_urls: string[]
  caption: string | null
  status: FeedPostStatus
  ig_media_id: string | null
  fb_post_id: string | null
  error: string | null
  attempt_count: number
  posted_at: Date | null
  metadata: Record<string, unknown> | null
}

class FeedPostsModuleService extends MedusaService({ FeedPost }) {
  /** The feed post for a given MU calendar date, if one exists. */
  async findByDate(postDate: string): Promise<FeedPostDTO | null> {
    const rows = await this.listFeedPosts({ post_date: postDate }, { take: 1 })
    return (rows[0] as unknown as FeedPostDTO) ?? null
  }

  /**
   * Product ids featured in a feed post on/after `sinceDate` (MU date string).
   * Used for dedup so the same product isn't re-posted within the window.
   * Excludes rows that were skipped (never actually shown) by default.
   */
  async getRecentlyFeaturedProductIds(
    sinceDate: string,
    opts: { includeSkipped?: boolean } = {},
  ): Promise<string[]> {
    const rows = await this.listFeedPosts(
      { post_date: { $gte: sinceDate } } as any,
      { take: 1000 },
    )
    const ids = new Set<string>()
    for (const r of rows as unknown as FeedPostDTO[]) {
      if (!r.product_id) continue
      if (!opts.includeSkipped && r.status === "skipped") continue
      ids.add(r.product_id)
    }
    return Array.from(ids)
  }

  async createPlanned(input: {
    post_date: string
    product_id: string | null
    product_snapshot: unknown | null
    image_urls: string[]
    caption: string | null
    status?: FeedPostStatus
    metadata?: Record<string, unknown> | null
  }): Promise<FeedPostDTO> {
    const created = await this.createFeedPosts({
      post_date: input.post_date,
      product_id: input.product_id,
      product_snapshot: input.product_snapshot,
      image_urls: input.image_urls,
      caption: input.caption,
      status: input.status ?? "planned",
      metadata: input.metadata ?? null,
    } as unknown as Parameters<this["createFeedPosts"]>[0])
    return (Array.isArray(created) ? created[0] : created) as unknown as FeedPostDTO
  }

  async markPosted(
    id: string,
    ids: { ig_media_id?: string | null; fb_post_id?: string | null },
  ): Promise<void> {
    await this.updateFeedPosts({
      id,
      status: "posted",
      ig_media_id: ids.ig_media_id ?? null,
      fb_post_id: ids.fb_post_id ?? null,
      error: null,
      posted_at: new Date(),
    } as unknown as Parameters<this["updateFeedPosts"]>[0])
  }

  /** Records a failed publish attempt, bumping attempt_count. */
  async markFailed(id: string, error: string): Promise<number> {
    const [row] = await this.listFeedPosts({ id })
    const attempts = ((row as unknown as FeedPostDTO)?.attempt_count ?? 0) + 1
    await this.updateFeedPosts({
      id,
      status: "failed",
      error: error.slice(0, 1000),
      attempt_count: attempts,
    } as unknown as Parameters<this["updateFeedPosts"]>[0])
    return attempts
  }
}

export default FeedPostsModuleService
