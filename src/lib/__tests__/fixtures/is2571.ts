import sharp from "sharp"

import type { FeedPostDTO } from "../../../modules/feed-posts/service"
import type { ProductLike } from "../../../modules/stories/snapshot"

/**
 * IS2571, the grid post the feed preview tests share: one colour (Black),
 * sizes S M L at Rs 1,100, two reviewed photos, planned for Fri 27 Nov 2026.
 */

export const FRONT = "https://cdn.dollupboutique.com/products/is2571-black-front.jpg"
export const BACK = "https://cdn.dollupboutique.com/products/is2571-black-back.jpg"
/** A photo the row reviewed that is no longer on the product. */
export const GONE = "https://cdn.dollupboutique.com/products/is2571-old.jpg"

const variant = (size: string) => ({
  id: `variant_${size}`,
  sku: `IS2571-BLACK-${size}`,
  inventory_quantity: 3,
  prices: [{ amount: 110000, currency_code: "mur" }],
  options: { color: "Black", size },
  images: [{ url: FRONT }, { url: BACK }],
})

/** The live product: what the 18:00 publish refreshes the row from. */
export const IS2571_PRODUCT: ProductLike = {
  id: "prod_is2571",
  title: "Satin Slip Dress",
  handle: "is2571",
  variants: ["S", "M", "L"].map(variant),
}

/** What the row stored when it was planned days ago: an older price and one size. */
export const STORED_SNAPSHOT = {
  name: "Satin Slip Dress",
  handle: "is2571",
  price_mur: 1250,
  compare_at_price_mur: null,
  variants_in_stock: [
    {
      id: "variant_S",
      sku: "IS2571-BLACK-S",
      color: "Black",
      color_code: null,
      sizes: ["S"],
      image_urls: [FRONT, GONE],
      price_mur: 1250,
      price_max_mur: 1250,
    },
  ],
}

export const PLANNED_ROW: FeedPostDTO = {
  id: "fp_1",
  post_date: "2026-11-27",
  product_id: "prod_is2571",
  product_snapshot: STORED_SNAPSHOT,
  image_urls: [FRONT, BACK],
  caption: "stored caption",
  status: "planned",
  ig_media_id: null,
  fb_post_id: null,
  error: null,
  attempt_count: 0,
  posted_at: null,
  metadata: { rotation_category: "dresses", auto: true },
}

/** A plain photo for the drawing code to work on. */
export function whitePng(): Promise<Buffer> {
  return sharp({ create: { width: 600, height: 800, channels: 3, background: "#ffffff" } }).png().toBuffer()
}
