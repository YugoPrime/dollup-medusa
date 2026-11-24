import { model } from "@medusajs/framework/utils"

// One row per Mauritius day: the shop's stock and what it is worth, as the
// admin Restock report counts it. Money is in whole rupees.
const StockSnapshot = model
  .define("StockSnapshot", {
    id: model.id({ prefix: "stksnap" }).primaryKey(),
    /** YYYY-MM-DD, Mauritius time. */
    day: model.text(),
    units: model.number(),
    cost_value_mur: model.number(),
    retail_value_mur: model.number(),
    uncosted_units: model.number(),
    products: model.number(),
  })
  .indexes([{ on: ["day"], unique: true }])

export default StockSnapshot
