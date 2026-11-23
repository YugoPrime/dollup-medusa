import { model } from "@medusajs/framework/utils"

const NewsletterCampaign = model.define("NewsletterCampaign", {
  id: model.id({ prefix: "nlcamp" }).primaryKey(),
  list: model.enum(["main", "after_dark"]),
  subject: model.text().default(""),
  preheader: model.text().nullable(),
  intro_text: model.text().nullable(),
  banner_url: model.text().nullable(),
  product_ids: model.json(),
  status: model.enum(["draft", "sending", "sent", "failed"]).default("draft"),
  resend_broadcast_id: model.text().nullable(),
  recipient_count: model.number().nullable(),
  sent_at: model.dateTime().nullable(),
  sent_by: model.text().nullable(),
  error: model.text().nullable(),
})

export default NewsletterCampaign
