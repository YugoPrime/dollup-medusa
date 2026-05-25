import { model } from "@medusajs/framework/utils"

const Lead = model.define("Lead", {
  id: model.id({ prefix: "lead" }).primaryKey(),
  list_id: model.text(),
  name: model.text().nullable(),
  phone: model.text().nullable(),
  note: model.text().nullable(),
  used_at: model.dateTime().nullable(),
  used_for_order_id: model.text().nullable(),
})

export default Lead
