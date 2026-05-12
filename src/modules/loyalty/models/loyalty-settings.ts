import { model } from "@medusajs/framework/utils"

/**
 * Single-row program settings for Doll Rewards.
 *
 * The service owns the singleton ID and creates the row lazily on first read.
 */
const LoyaltySettings = model.define("LoyaltySettings", {
  id: model.id({ prefix: "loyset" }).primaryKey(),
  earn_rate_per_100_mur: model.number().default(2),
  redeem_rate_mur_per_100_pts: model.number().default(100),
  min_redeem_points: model.number().default(150),
  welcome_bonus_points: model.number().default(100),
  points_expiry_months: model.number().nullable(),
})

export default LoyaltySettings
