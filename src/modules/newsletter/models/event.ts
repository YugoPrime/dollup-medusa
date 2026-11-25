import { model } from "@medusajs/framework/utils"

/**
 * One Resend webhook event for a newsletter email (delivered, opened, clicked, bounced…).
 * Only events that carry a broadcast id of one of our campaigns are stored.
 */
const NewsletterEvent = model
  .define("NewsletterEvent", {
    id: model.id({ prefix: "nlevt" }).primaryKey(),
    // Svix message id: Resend retries deliver the same id, so it makes inserts idempotent.
    svix_id: model.text(),
    campaign_id: model.text(),
    broadcast_id: model.text(),
    email_id: model.text(),
    // "delivered" | "delivery_delayed" | "bounced" | "complained" | "opened" | "clicked" | "failed" | "suppressed"
    type: model.text(),
    email: model.text().nullable(),
    link: model.text().nullable(),
    bounce_type: model.text().nullable(),
    occurred_at: model.dateTime(),
  })
  .indexes([
    { on: ["svix_id"], unique: true },
    { on: ["campaign_id", "type"] },
  ])

export default NewsletterEvent
