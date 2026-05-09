import { model } from "@medusajs/framework/utils"
import { Thread } from "./thread"

export const Message = model
  .define("chat_message", {
    id: model.id({ prefix: "msg" }).primaryKey(),
    thread: model.belongsTo(() => Thread, { mappedBy: "messages" }),
    direction: model.enum(["inbound", "outbound"]),
    external_id: model.text().nullable(),
    sender_kind: model.enum(["customer", "staff", "ai"]).default("customer"),
    sender_user_id: model.text().nullable(),
    body: model.text().nullable(),
    attachments: model.json().nullable(),
    meta_status: model
      .enum(["pending", "sent", "delivered", "read", "failed"])
      .default("pending"),
    meta_error: model.text().nullable(),
    draft_reply: model.json().nullable(),
    draft_confidence: model.number().nullable(),
  })
  .indexes([{ on: ["external_id"], where: "external_id IS NOT NULL", unique: true }])
