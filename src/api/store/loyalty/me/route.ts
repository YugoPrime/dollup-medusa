import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"

import { LOYALTY_MODULE } from "../../../../modules/loyalty"
import type LoyaltyModuleService from "../../../../modules/loyalty/service"

/**
 * GET /store/loyalty/me
 *
 * Auth: customer (Bearer or session).
 * The /store/* router runs the customer auth middleware in
 * `allowUnauthenticated: true` mode, so we manually 401 if there's no
 * actor. Returns the caller's loyalty account, creating one on first hit.
 */
export const GET = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    res.status(401).json({ message: "Unauthorized" })
    return
  }

  const loyaltyService = req.scope.resolve<LoyaltyModuleService>(LOYALTY_MODULE)
  const account = await loyaltyService.getAccount(customerId)

  res.json({
    loyalty: {
      points_balance: account.points_balance,
      lifetime_earned: account.lifetime_earned,
      lifetime_redeemed: account.lifetime_redeemed,
    },
  })
}
