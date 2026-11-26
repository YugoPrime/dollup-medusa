import type { MedusaContainer } from "@medusajs/framework/types"

import type { FeedPostDTO } from "../modules/feed-posts/service"
import { buildFeedPreviewImages, type FeedPreviewImage } from "./feed-preview"
import { loadGridProduct } from "./grid-planner"
import { refreshGridContent } from "./grid-rotation"

/**
 * One grid row as it will post, drawn: shared by the Feed Planner preview
 * (GET /admin/feed-posts/:id/preview) and the evening Telegram preview of
 * tomorrow's post (jobs/tomorrow-feed-preview.ts).
 *
 * A row that hasn't gone out yet is refreshed from the live product (price,
 * sizes, caption, only the reviewed photos still on it), exactly as the 18:00
 * publish refreshes it, and `live` is true. A posted row, or one whose product
 * can't be refreshed, is shown as stored.
 */

export type FeedRowPreview = {
  images: FeedPreviewImage[]
  /** True when drawn from the live product, as the 18:00 publish will post it. */
  live: boolean
  image_urls: string[]
  product_snapshot: unknown
  caption: string | null
}

export async function previewFeedRow(
  scope: MedusaContainer,
  row: Pick<FeedPostDTO, "status" | "product_id" | "image_urls" | "product_snapshot" | "caption">,
  opts: { fetchImage?: (url: string) => Promise<Buffer> } = {},
): Promise<FeedRowPreview> {
  let imageUrls = Array.isArray(row.image_urls) ? (row.image_urls as string[]) : []
  let snapshot: unknown = row.product_snapshot
  let caption = row.caption
  let live = false
  if (row.status !== "posted" && row.product_id) {
    const { product } = await loadGridProduct(scope, row.product_id)
    const refreshed = product ? refreshGridContent(imageUrls, product) : null
    if (refreshed) {
      imageUrls = refreshed.image_urls
      snapshot = refreshed.product_snapshot
      caption = refreshed.caption
      live = true
    }
  }

  const images = await buildFeedPreviewImages({ imageUrls, snapshot, fetchImage: opts.fetchImage })
  return { images, live, image_urls: imageUrls, product_snapshot: snapshot, caption }
}
