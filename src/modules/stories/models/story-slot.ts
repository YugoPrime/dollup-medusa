import { model } from "@medusajs/framework/utils"
import StoryPlan from "./story-plan"

/**
 * One slot per scheduled IG-story post-time on a plan. The product is picked
 * by the service; the snapshot is captured at pick time so the slot stays
 * stable even if Medusa's product/inventory data changes. Sold-out variants
 * are filtered out of the snapshot.
 */
const StorySlot = model
  .define("StorySlot", {
    id: model.id({ prefix: "stslot" }).primaryKey(),
    slot_index: model.number(),
    scheduled_at: model.dateTime(),
    category_id: model.text(),
    product_id: model.text().nullable(),
    product_snapshot: model.json().nullable(),
    metadata: model.json().nullable(),
    fallback_used: model.boolean().default(false),
    posted_at: model.dateTime().nullable(),
    pick_attempt: model.number().default(1),
    plan: model.belongsTo(() => StoryPlan, { mappedBy: "slots" }),
  })
  .indexes([
    {
      on: ["plan_id", "slot_index"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default StorySlot
