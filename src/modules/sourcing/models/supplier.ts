import { model } from "@medusajs/framework/utils"
import DraftOrder from "./draft-order"

const Supplier = model
  .define("Supplier", {
    id: model.id({ prefix: "supp" }).primaryKey(),
    name: model.text(),
    contact_handle: model.text().nullable(),
    notes: model.text().nullable(),
    archived_at: model.dateTime().nullable(),
    drafts: model.hasMany(() => DraftOrder, { mappedBy: "supplier" }),
  })
  .indexes([{ on: ["archived_at"] }])

export default Supplier
