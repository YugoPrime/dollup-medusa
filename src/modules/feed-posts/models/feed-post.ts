import { model } from "@medusajs/framework/utils"

/**
 * One IG/FB *feed* post (not a story). The daily cron creates one row per
 * Mauritius calendar day featuring a single product, using the product's own
 * photos (no story template). Status + product_id + post_date give us the
 * dedup history so the same product isn't re-posted within the dedup window.
 */
const FeedPost = model.define("FeedPost", {
  id: model.id({ prefix: "fpost" }).primaryKey(),
  // Mauritius local calendar date "YYYY-MM-DD" — one feed post per day.
  post_date: model.text(),
  product_id: model.text().nullable(),
  // Snapshot of the product at pick time (price/sizes/colors/images), same
  // shape as the stories ProductSnapshot.
  product_snapshot: model.json().nullable(),
  // The exact ordered image URLs handed to Meta (carousel order).
  image_urls: model.json(),
  caption: model.text().nullable(),
  status: model
    .enum(["planned", "posted", "failed", "skipped"])
    .default("planned"),
  ig_media_id: model.text().nullable(),
  fb_post_id: model.text().nullable(),
  error: model.text().nullable(),
  attempt_count: model.number().default(0),
  posted_at: model.dateTime().nullable(),
  metadata: model.json().nullable(),
})

export default FeedPost
