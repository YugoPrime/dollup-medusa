import { model } from "@medusajs/framework/utils"

const LeadList = model.define("LeadList", {
  id: model.id({ prefix: "leadlist" }).primaryKey(),
  name: model.text().unique(),
})

export default LeadList
