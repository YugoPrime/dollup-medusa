import { model } from "@medusajs/framework/utils"
import { Contact } from "./contact"
import { Message } from "./message"

export const Thread = model
  .define("chat_thread", {
    id: model.id({ prefix: "thr" }).primaryKey(),
    channel: model.enum(["whatsapp", "messenger", "instagram"]),
    contact: model.belongsTo(() => Contact),
    status: model.enum(["open", "snoozed", "closed"]).default("open"),
    last_message_at: model.dateTime().nullable(),
    last_inbound_at: model.dateTime().nullable(),
    unread_count: model.number().default(0),
    assignee_id: model.text().nullable(),
    messages: model.hasMany(() => Message),
  })
  .indexes([{ on: ["channel", "contact_id"], unique: true }])
