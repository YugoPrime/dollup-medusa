import { model } from "@medusajs/framework/utils"

import PreorderQuoteItem from "./preorder-quote-item"

/**
 * One client submission to /preorder/request. Holds contact + lifecycle status;
 * the actual links/quotes live on PreorderQuoteItem children.
 */
const PreorderQuoteRequest = model.define("PreorderQuoteRequest", {
  id: model.id({ prefix: "pqreq" }).primaryKey(),
  // { whatsapp: string, name?: string }
  contact: model.json(),
  status: model
    .enum([
      "pending",
      "quoted",
      "partial",
      "needs_manual",
      "reserved",
      "expired",
      "abandoned",
    ])
    .default("pending"),
  notes: model.text().nullable(),
  items_count: model.number().default(0),
  client_ip: model.text().nullable(),
  reserved_cart_id: model.text().nullable(),
  expires_at: model.dateTime().nullable(),
  items: model.hasMany(() => PreorderQuoteItem, { mappedBy: "request" }),
})

export default PreorderQuoteRequest
