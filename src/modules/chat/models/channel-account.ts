import { model } from "@medusajs/framework/utils"

export const ChannelAccount = model.define("chat_channel_account", {
  id: model.id({ prefix: "chacc" }).primaryKey(),
  channel: model.enum(["whatsapp", "messenger", "instagram"]),
  external_id: model.text(),
  display_name: model.text(),
  access_token_enc: model.text(),
  webhook_verify_token: model.text(),
  is_active: model.boolean().default(true),
})
