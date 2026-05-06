import { model } from "@medusajs/framework/utils"

const ShippingSettings = model.define("ShippingSettings", {
  id: model.id({ prefix: "shipset" }).primaryKey(),
  free_shipping_threshold_mur: model.number().default(1500),
  return_fee_mur: model.number().default(70),
  preorder_eta_copy: model.text().default(
    "Confirm before noon to receive your order the next day across Mauritius.",
  ),
})

export default ShippingSettings
