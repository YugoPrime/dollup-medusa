import { model } from "@medusajs/framework/utils"
import DraftItem from "./draft-item"

const DraftCostHistory = model.define("DraftCostHistory", {
  id: model.id({ prefix: "dchi" }).primaryKey(),
  draft_item: model.belongsTo(() => DraftItem, { mappedBy: "cost_history" }),
  old_cost_usd: model.number(),
  new_cost_usd: model.number(),
  reason: model.text(),
  changed_at: model.dateTime().default(new Date()),
})

export default DraftCostHistory
