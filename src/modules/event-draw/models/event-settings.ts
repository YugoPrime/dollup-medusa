import { model } from "@medusajs/framework/utils"

// Singleton wheel config. weights_json = JSON string of { slice: weight }.
const EventSettings = model.define("EventSettings", {
  id: model.id({ prefix: "evtset" }).primaryKey(),
  singleton: model.text().default("default"), // always "default"; unique
  weights_json: model.text(),
  active_draw_period: model.text(), // e.g. "2026-07"
}).indexes([{ on: ["singleton"], unique: true, where: "deleted_at IS NULL" }])

export default EventSettings
