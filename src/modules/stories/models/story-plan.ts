import { model } from "@medusajs/framework/utils"
import StorySlot from "./story-slot"

/**
 * One plan per date (single-tenant). Created via /admin/stories/plans, then
 * filled by regenerate(). Status transitions are managed by the service:
 *   draft → active (after first successful regenerate)
 *          → completed (when every slot has posted_at)
 *   active ← completed (if a slot is unmarked)
 */
const StoryPlan = model
  .define("StoryPlan", {
    id: model.id({ prefix: "stplan" }).primaryKey(),
    plan_date: model.dateTime(),
    total_slots: model.number(),
    category_distribution: model.json(),
    scheduled_times: model.json(),
    status: model.enum(["draft", "active", "completed"]).default("draft"),
    notes: model.text().nullable(),
    slots: model.hasMany(() => StorySlot, { mappedBy: "plan" }),
  })
  .indexes([
    {
      on: ["plan_date"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default StoryPlan
