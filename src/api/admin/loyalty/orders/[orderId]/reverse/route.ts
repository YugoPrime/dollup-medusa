import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

import { LOYALTY_MODULE } from "../../../../../../modules/loyalty"
import type LoyaltyModuleService from "../../../../../../modules/loyalty/service"

/**
 * POST /admin/loyalty/orders/:orderId/reverse
 *
 * Auth: admin user (handled by global /admin/* middleware).
 * Body: { reason?: string }
 *
 * Refund-driven loyalty reversal. Pulls back the points the customer earned
 * on this order. May push the balance below zero — that's the point.
 *
 * Idempotent. Safe to call multiple times for the same orderId.
 *
 * Returns:
 *   { reversed: number, balance: number, customer_id: string | null }
 *
 * Special cases:
 *   - Order has no customer (guest): returns { reversed: 0, balance: 0, customer_id: null }
 *   - Order had no points awarded: returns { reversed: 0, balance: <current> }
 *   - Already reversed: returns existing { reversed, balance }
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const orderId = req.params.orderId
  if (!orderId) {
    res.status(400).json({ message: "orderId is required" })
    return
  }

  const body = (req.body ?? {}) as { reason?: unknown }
  const reasonInput = typeof body.reason === "string" ? body.reason.trim() : ""
  const reason = reasonInput || `Refund reversal for order ${orderId}`

  const orderModuleService = req.scope.resolve(Modules.ORDER)
  let order
  try {
    order = await orderModuleService.retrieveOrder(orderId, {
      select: ["id", "customer_id", "display_id"],
    })
  } catch {
    res.status(404).json({ message: `Order ${orderId} not found` })
    return
  }

  if (!order.customer_id) {
    res.json({ reversed: 0, balance: 0, customer_id: null })
    return
  }

  const loyaltyService =
    req.scope.resolve<LoyaltyModuleService>(LOYALTY_MODULE)

  try {
    const result = await loyaltyService.reversePointsForOrder(
      order.customer_id,
      orderId,
      { reason },
    )
    res.json({ ...result, customer_id: order.customer_id })
  } catch (err) {
    res.status(400).json({
      message: (err as Error)?.message ?? "Reversal failed",
    })
  }
}
