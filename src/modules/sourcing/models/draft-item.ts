import { model } from "@medusajs/framework/utils"
import DraftOrder from "./draft-order"
import DraftVariant from "./draft-variant"
import DraftCostHistory from "./draft-cost-history"

export const SOURCE_TYPES = ["alibaba", "pdf", "manual"] as const

const DraftItem = model.define("DraftItem", {
  id: model.id({ prefix: "ditm" }).primaryKey(),
  draft_order: model.belongsTo(() => DraftOrder, { mappedBy: "items" }),
  source_url: model.text().nullable(),
  source_type: model.enum([...SOURCE_TYPES]).default("manual"),
  scraped_title: model.text().nullable(),
  scraped_image_url: model.text().nullable(),
  working_name: model.text().nullable(),
  cost_usd: model.number().default(0),
  notes: model.text().nullable(),
  position: model.number().default(0),
  uploaded_image_r2_key: model.text().nullable(),
  // Map of color name -> R2 key for per-color hero image. JSON column.
  // Empty/null means no per-color images; storefront falls back to the
  // product's primary image (uploaded_image_r2_key / scraped_image_url).
  color_images: model.json().nullable(),
  // Stage B additions
  ref: model.text().nullable(),
  selling_price_mur: model.number().nullable(),
  category_id: model.text().nullable(),
  published_product_id: model.text().nullable(),
  published_at: model.dateTime().nullable(),
  variants: model.hasMany(() => DraftVariant, { mappedBy: "draft_item" }),
  cost_history: model.hasMany(() => DraftCostHistory, { mappedBy: "draft_item" }),
})

export default DraftItem
