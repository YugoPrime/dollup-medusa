import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { LOYALTY_MODULE } from "../../../../../modules/loyalty"
import type LoyaltyModuleService from "../../../../../modules/loyalty/service"

/**
 * GET /admin/loyalty/accounts/:customerId
 *
 * Auth: admin user (handled by global /admin/* middleware).
 * Returns the loyalty account for the given customer, plus the 10 most
 * recent ledger rows (for the admin widget).
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const customerId = req.params.customerId
  if (!customerId) {
    res.status(400).json({ message: "customerId is required" })
    return
  }

  const loyaltyService = req.scope.resolve<LoyaltyModuleService>(LOYALTY_MODULE)
  const account = await loyaltyService.getAccount(customerId)
  const txns = await loyaltyService.listTransactions(customerId, {
    limit: 10,
    offset: 0,
  })

  res.json({
    loyalty: {
      id: account.id,
      customer_id: account.customer_id,
      points_balance: account.points_balance,
      lifetime_earned: account.lifetime_earned,
      lifetime_redeemed: account.lifetime_redeemed,
      created_at: account.created_at,
      updated_at: account.updated_at,
    },
    transactions: txns.items.map((t) => ({
      id: t.id,
      type: t.type,
      points: t.points,
      reason: t.reason,
      order_id: t.order_id,
      created_at: t.created_at,
    })),
    transactions_count: txns.count,
  })
}
