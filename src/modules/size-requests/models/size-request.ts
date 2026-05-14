import { model } from "@medusajs/framework/utils"

const SizeRequest = model.define("SizeRequest", {
  id: model.id({ prefix: "sr" }).primaryKey(),
  platform: model.text(),
  contact: model.text(),
  note: model.text(),
})

export default SizeRequest
