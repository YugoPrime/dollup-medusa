import { model } from "@medusajs/framework/utils"

import PreorderQuoteRequest from "./preorder-quote-request"

/**
 * One SHEIN link within a quote request. Doubles as the daemon job row:
 * status drives the scrape lifecycle (pending -> scraping -> quoted/...).
 */
const PreorderQuoteItem = model.define("PreorderQuoteItem", {
  id: model.id({ prefix: "pqitem" }).primaryKey(),
  request: model.belongsTo(() => PreorderQuoteRequest, { mappedBy: "items" }),
  position: model.number().default(0),
  shein_url: model.text(),

  // Job state
  status: model
    .enum([
      "pending",
      "scraping",
      "quoted",
      "needs_manual",
      "failed",
      "reserved",
    ])
    .default("pending"),
  attempts: model.number().default(0),
  locked_at: model.dateTime().nullable(),
  last_attempt_at: model.dateTime().nullable(),
  last_error_kind: model
    .enum([
      "challenge",
      "removed",
      "parse-fail",
      "network-error",
      "timeout",
      "invalid-url",
    ])
    .nullable(),

  // Scrape result
  scraped_title: model.text().nullable(),
  scraped_thumbnail: model.text().nullable(),
  scraped_price_usd: model.number().nullable(),
  color_options: model.json().nullable(),
  size_options: model.json().nullable(),

  // Pricing snapshot (binding quote)
  all_in_price_mur: model.number().nullable(),
  price_breakdown: model.json().nullable(),
  fx_rate_used: model.number().nullable(),
  settings_snapshot: model.json().nullable(),

  // Client selection
  selected_size: model.text().nullable(),
  selected_color: model.text().nullable(),

  // Reserve
  reserved_product_id: model.text().nullable(),
  reserved_at: model.dateTime().nullable(),
})

export default PreorderQuoteItem
