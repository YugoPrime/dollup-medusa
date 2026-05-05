import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { LOYALTY_MODULE } from "../../../../../../modules/loyalty"
import type LoyaltyModuleService from "../../../../../../modules/loyalty/service"

/**
 * POST /admin/loyalty/accounts/:customerId/adjust
 *
 * Auth: admin user.
 * Body: { delta: number, reason: string }
 *
 * Manual admin adjustment. Positive delta credits, negative debits.
 * Refuses to push the balance below zero.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const customerId = req.params.customerId
  if (!customerId) {
    res.status(400).json({ message: "customerId is required" })
    return
  }

  const body = (req.body ?? {}) as { delta?: unknown; reason?: unknown }
  const delta = Number(body.delta)
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""

  if (!Number.isFinite(delta) || delta === 0) {
    res
      .status(400)
      .json({ message: "delta must be a non-zero integer" })
    return
  }
  if (!reason) {
    res.status(400).json({ message: "reason is required" })
    return
  }

  const adminActor = req.auth_context?.actor_id ?? "unknown-admin"

  const loyaltyService = req.scope.resolve<LoyaltyModuleService>(LOYALTY_MODULE)
  try {
    const account = await loyaltyService.adjustPoints(customerId, delta, {
      reason: `[admin:${adminActor}] ${reason}`,
    })

    res.json({
      loyalty: {
        id: account.id,
        customer_id: account.customer_id,
        points_balance: account.points_balance,
        lifetime_earned: account.lifetime_earned,
        lifetime_redeemed: account.lifetime_redeemed,
      },
    })
  } catch (err) {
    res.status(400).json({
      message: (err as Error)?.message ?? "Adjustment failed",
    })
  }
}
