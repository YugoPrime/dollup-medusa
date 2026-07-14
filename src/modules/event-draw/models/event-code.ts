import { model } from "@medusajs/framework/utils"

// One physical thank-you-card code. Single-use: redeemed_at set on first entry.
const EventCode = model
  .define("EventCode", {
    id: model.id({ prefix: "evtcode" }).primaryKey(),
    code: model.text(),          // e.g. "DUB-7K3P" (uppercased, normalized)
    batch_id: model.text(),      // print batch grouping
    redeemed_at: model.dateTime().nullable(),
  })
  .indexes([{ on: ["code"], unique: true, where: "deleted_at IS NULL" }])

export default EventCode
