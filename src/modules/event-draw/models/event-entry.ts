import { model } from "@medusajs/framework/utils"

// One entry per redeemed code. Holds contact capture + spin accounting.
const EventEntry = model.define("EventEntry", {
  id: model.id({ prefix: "evtent" }).primaryKey(),
  code: model.text(),
  email: model.text(),
  phone: model.text(),
  consent: model.boolean().default(false),
  spins_earned: model.number().default(1),
  spins_used: model.number().default(0),
  review_bonus_claimed: model.boolean().default(false),
  social_bonus_claimed: model.boolean().default(false),
  customer_id: model.text().nullable(), // set when points credited
  ip: model.text().nullable(),
})

export default EventEntry
