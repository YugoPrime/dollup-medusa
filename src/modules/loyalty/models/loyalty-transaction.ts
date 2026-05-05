import { model } from "@medusajs/framework/utils"
import LoyaltyAccount from "./loyalty-account"

/**
 * Append-only ledger of every points movement. We never UPDATE rows here,
 * only INSERT — every earn / redeem / adjustment / expire is a new row so
 * we can reconstruct or audit any account's balance.
 *
 * - points: signed integer
 *     earn / positive adjustment   -> positive
 *     redeem / expire / negative   -> negative
 * - order_id: nullable, set whenever the movement is tied to an order
 *     (used for idempotency on order.placed).
 */
const LoyaltyTransaction = model.define("LoyaltyTransaction", {
  id: model.id({ prefix: "loytxn" }).primaryKey(),
  type: model.enum(["earn", "redeem", "adjustment", "expire"]),
  points: model.number(),
  reason: model.text(),
  order_id: model.text().nullable(),
  account: model.belongsTo(() => LoyaltyAccount, {
    mappedBy: "transactions",
  }),
})

export default LoyaltyTransaction
