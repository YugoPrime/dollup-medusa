import { model } from "@medusajs/framework/utils"

/**
 * Single-row settings table. Keyed on a fixed id ("story_settings") in service.ts,
 * matching the LoyaltySettings pattern.
 */
const StorySettings = model.define("StorySettings", {
  id: model.id({ prefix: "stset" }).primaryKey(),
  anti_repeat_days: model.number().default(7),
  caption_template: model.text().default("{name} — Rs {price} · {sizes} · {link}"),
  // JSON array fields — DML's `.default()` is typed for objects only, so the
  // SQL-side default ('[]') in the migration is the source of truth.
  default_distribution: model.json(),
  default_schedule: model.json(),
  stock_alert_threshold: model.number().default(0),
})

export default StorySettings
