import { model } from "@medusajs/framework/utils"

const EmailSettings = model.define("EmailSettings", {
  id: model.id({ prefix: "emailset" }).primaryKey(),
  enabled_order_placed: model.boolean().default(true),
  enabled_order_shipped: model.boolean().default(true),
  enabled_welcome: model.boolean().default(true),
  enabled_password_reset: model.boolean().default(true),
  enabled_order_delivered: model.boolean().default(false),
  from_email_mirror: model.text().default(""),
})

export default EmailSettings
