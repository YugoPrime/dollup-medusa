import { model } from "@medusajs/framework/utils"

// Grand-prize draw ticket for a period, e.g. "2026-07".
const EventDrawEntry = model.define("EventDrawEntry", {
  id: model.id({ prefix: "evtdraw" }).primaryKey(),
  entry_id: model.text(),
  draw_period: model.text(),
  is_winner: model.boolean().default(false),
})

export default EventDrawEntry
