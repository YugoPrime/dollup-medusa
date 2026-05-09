import { model } from "@medusajs/framework/utils"

const SourcingSettings = model.define("SourcingSettings", {
  id: model.id().primaryKey(),
  fx_rate: model.number().default(46),
  landed_multiplier_default: model.number().default(1.5),
  markup_multiplier: model.number().default(2.5),
  round_step: model.number().default(50),
})

export default SourcingSettings
