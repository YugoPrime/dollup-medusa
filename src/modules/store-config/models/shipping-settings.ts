import { model } from "@medusajs/framework/utils"

const ShippingSettings = model.define("ShippingSettings", {
  id: model.id({ prefix: "shipset" }).primaryKey(),
  free_shipping_threshold_mur: model.number().default(1500),
  return_fee_mur: model.number().default(70),
  // Whole hour, Mauritius time (UTC+4). Reset to 12 each morning by the
  // ask-delivery-cutoff job; the owner taps a later time when the courier
  // is coming late. See src/lib/delivery-cutoff.ts.
  next_day_cutoff_hour: model.number().default(12),
  preorder_eta_copy: model.text().default(
    "Confirm before noon to receive your order the next day across Mauritius.",
  ),
})

export default ShippingSettings
