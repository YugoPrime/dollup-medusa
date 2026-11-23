import { model } from "@medusajs/framework/utils"

const NewsletterSubscriber = model
  .define("NewsletterSubscriber", {
    id: model.id({ prefix: "nlsub" }).primaryKey(),
    email: model.text(),
    list: model.enum(["main", "after_dark"]),
    source: model.enum(["footer", "after_dark_pdp", "checkout", "import", "admin"]),
    status: model.enum(["subscribed", "unsubscribed"]).default("subscribed"),
    subscribed_at: model.dateTime(),
    unsubscribed_at: model.dateTime().nullable(),
    resend_contact_id: model.text().nullable(),
    resend_synced_at: model.dateTime().nullable(),
    resend_sync_error: model.text().nullable(),
  })
  .indexes([{ on: ["email", "list"], unique: true }])

export default NewsletterSubscriber
