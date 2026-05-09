import { model } from "@medusajs/framework/utils"

export const Contact = model
  .define("chat_contact", {
    id: model.id({ prefix: "ctc" }).primaryKey(),
    channel: model.enum(["whatsapp", "messenger", "instagram"]),
    external_id: model.text(),
    display_name: model.text().nullable(),
    profile_pic_url: model.text().nullable(),
    link_status: model.enum(["auto", "manual", "unknown"]).default("unknown"),
    last_seen_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([{ on: ["channel", "external_id"], unique: true }])
