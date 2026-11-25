import sharp from "sharp"

import { fetchImageBytes, normalizeFeedImage } from "./feed-image-prep"
import { type FeedPriceLabel, priceForPhoto, productCode } from "./feed-price-label"
import { sizesForPhoto } from "./feed-size-label"

/**
 * The grid post as it will go out, for the owner's Feed Planner: every photo
 * drawn by the same code the 18:00 publish uses (code, price and size row), at half
 * size so a day's preview stays light.
 */

export type FeedPreviewImage = {
  source_url: string
  sizes: string[]
  price: FeedPriceLabel | null
  sku: string | null
  /** `data:image/jpeg;base64,…`, or null when this photo couldn't be drawn. */
  data_url: string | null
  error?: string
}

const PREVIEW_WIDTH = 540
const PREVIEW_HEIGHT = 675
const PREVIEW_QUALITY = 80

export async function buildFeedPreviewImages(args: {
  imageUrls: string[]
  snapshot: unknown
  fetchImage?: (url: string) => Promise<Buffer>
}): Promise<FeedPreviewImage[]> {
  const fetchImage = args.fetchImage ?? fetchImageBytes
  const snapshot = args.snapshot as Parameters<typeof sizesForPhoto>[0] & Parameters<typeof productCode>[0]
  const sku = productCode(snapshot)
  return Promise.all(
    args.imageUrls.map(async (url): Promise<FeedPreviewImage> => {
      const sizes = sizesForPhoto(snapshot, url)
      const price = priceForPhoto(snapshot, url)
      try {
        const full = await normalizeFeedImage(await fetchImage(url), { sizes, price, sku })
        const small = await sharp(full)
          .resize(PREVIEW_WIDTH, PREVIEW_HEIGHT)
          .jpeg({ quality: PREVIEW_QUALITY })
          .toBuffer()
        return { source_url: url, sizes, price, sku, data_url: `data:image/jpeg;base64,${small.toString("base64")}` }
      } catch (err) {
        return { source_url: url, sizes, price, sku, data_url: null, error: (err as Error)?.message ?? "preview failed" }
      }
    }),
  )
}
