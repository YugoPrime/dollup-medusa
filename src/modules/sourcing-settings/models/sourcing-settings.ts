import { model } from "@medusajs/framework/utils"

const SourcingSettings = model.define("SourcingSettings", {
  id: model.id().primaryKey(),
  fx_rate: model.number().default(46),
  landed_multiplier_default: model.number().default(1.5),
  // Flat MUR amount added after FX × landed, before markup. Lets the recommended
  // price formula express an affine model (cost × fx × landed + flat) × markup,
  // e.g. ((cost × 51) + 200) × 2. Default 0 keeps the legacy purely-multiplicative
  // behaviour for any existing row.
  flat_add_mur: model.number().default(0),
  markup_multiplier: model.number().default(2.5),
  round_step: model.number().default(50),
})

export default SourcingSettings
