import { model } from "@medusajs/framework/utils"

// A single spin outcome. type=points → credited to loyalty; draw_entry → row in EventDrawEntry.
const EventReward = model
  .define("EventReward", {
    id: model.id({ prefix: "evtrew" }).primaryKey(),
    entry_id: model.text(),
    slice: model.text(),          // "pts_50" | "pts_100" | "pts_200" | "draw_entry" | "gift"
    type: model.text(),           // "points" | "draw_entry" | "gift"
    points: model.number().default(0),
    status: model.text().default("issued"), // issued | credited | failed
    idempotency_key: model.text(),
  })
  .indexes([{ on: ["idempotency_key"], unique: true, where: "deleted_at IS NULL" }])

export default EventReward
