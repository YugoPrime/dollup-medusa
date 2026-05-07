import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

import { LOYALTY_MODULE } from "../../../../../../modules/loyalty"
import type LoyaltyModuleService from "../../../../../../modules/loyalty/service"

/**
 * POST /admin/loyalty/orders/:orderId/restore
 *
 * Companion to /reverse — restores points after a refund is voided.
 * Idempotent. No-op if no reversal exists or restore already done.
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
  const reason = reasonInput || `Refund void — points restored for order ${orderId}`

  const orderModuleService = req.scope.resolve(Modules.ORDER)
  let order
  try {
    order = await orderModuleService.retrieveOrder(orderId, {
      select: ["id", "customer_id"],
    })
  } catch {
    res.status(404).json({ message: `Order ${orderId} not found` })
    return
  }

  if (!order.customer_id) {
    res.json({ restored: 0, balance: 0, customer_id: null })
    return
  }

  const loyaltyService =
    req.scope.resolve<LoyaltyModuleService>(LOYALTY_MODULE)

  try {
    const result = await loyaltyService.restorePointsForOrder(
      order.customer_id,
      orderId,
      { reason },
    )
    res.json({ ...result, customer_id: order.customer_id })
  } catch (err) {
    res.status(400).json({
      message: (err as Error)?.message ?? "Restore failed",
    })
  }
}
