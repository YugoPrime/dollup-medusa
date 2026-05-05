import { model } from "@medusajs/framework/utils"
import LoyaltyTransaction from "./loyalty-transaction"

/**
 * One account per customer. Created lazily on first earn/adjust.
 *
 * - points_balance:    current redeemable balance (>= 0)
 * - lifetime_earned:   total points ever credited via "earn"
 * - lifetime_redeemed: total points ever debited via "redeem"
 *
 * Adjustments (admin) move points_balance up or down but only touch
 * lifetime_earned/redeemed when the delta is positive/negative respectively
 * — see service.ts.
 */
const LoyaltyAccount = model
  .define("LoyaltyAccount", {
    id: model.id({ prefix: "loyacc" }).primaryKey(),
    customer_id: model.text(),
    points_balance: model.number().default(0),
    lifetime_earned: model.number().default(0),
    lifetime_redeemed: model.number().default(0),
    transactions: model.hasMany(() => LoyaltyTransaction, {
      mappedBy: "account",
    }),
  })
  .indexes([
    {
      on: ["customer_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ])

export default LoyaltyAccount
