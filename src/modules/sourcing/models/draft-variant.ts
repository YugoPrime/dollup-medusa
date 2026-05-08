import { model } from "@medusajs/framework/utils"
import DraftItem from "./draft-item"

const DraftVariant = model
  .define("DraftVariant", {
    id: model.id({ prefix: "dvar" }).primaryKey(),
    draft_item: model.belongsTo(() => DraftItem, { mappedBy: "variants" }),
    color: model.text().nullable(),
    size: model.text(),
    qty: model.number().default(0),
  })
  .indexes([
    {
      on: ["draft_item_id", "color", "size"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default DraftVariant
