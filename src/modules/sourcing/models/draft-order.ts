import { model } from "@medusajs/framework/utils"
import Supplier from "./supplier"
import DraftItem from "./draft-item"

export const DRAFT_ORDER_STATUSES = [
  "drafting",
  "negotiating",
  "paid",
  "shipped",
  "received",
] as const

const DraftOrder = model
  .define("DraftOrder", {
    id: model.id({ prefix: "dord" }).primaryKey(),
    supplier: model.belongsTo(() => Supplier, { mappedBy: "drafts" }),
    status: model.enum([...DRAFT_ORDER_STATUSES]).default("drafting"),
    currency: model.text().default("USD"),
    landed_cost_multiplier: model.number().default(1.5),
    fx_rate: model.number().nullable(),
    notes: model.text().nullable(),
    paid_at: model.dateTime().nullable(),
    shipped_at: model.dateTime().nullable(),
    received_at: model.dateTime().nullable(),
    archived_at: model.dateTime().nullable(),
    items: model.hasMany(() => DraftItem, { mappedBy: "draft_order" }),
  })
  .indexes([{ on: ["status"] }, { on: ["archived_at"] }])

export default DraftOrder
