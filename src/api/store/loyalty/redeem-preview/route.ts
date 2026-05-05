import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { LOYALTY_MODULE } from "../../../../modules/loyalty"
import type LoyaltyModuleService from "../../../../modules/loyalty/service"
import {
  calculateMaxRedeemablePoints,
  calculateRedemptionDiscount,
} from "../../../../workflows/apply-loyalty-discount"

/**
 * Doll Rewards redemption preview.
 *
 *   Redemption rate is configurable in loyalty settings.
 *   Cap: 50% of cart subtotal (i.e. customer pays at least half).
 *
 * Read-only; never mutates the cart, balance, or ledger.
 *
 * POST /store/loyalty/redeem-preview
 *   body: { cart_id: string, points: number }
 * Response:
 *   {
 *     loyalty: {
 *       points_balance: number,
 *       max_redeemable: number,   // cap from balance + 50% rule
 *       requested_points: number, // echoed, clamped to max_redeemable
 *       discount_mur: number,     // value in major units
 *       balance_after: number     // balance - requested_points
 *     }
 *   }
 */
export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    res.status(401).json({ message: "Unauthorized" })
    return
  }

  const body = (req.body ?? {}) as { cart_id?: unknown; points?: unknown }
  const cartId = typeof body.cart_id === "string" ? body.cart_id : ""
  const requested = Number(body.points)

  if (!cartId) {
    res.status(400).json({ message: "cart_id is required" })
    return
  }
  if (!Number.isFinite(requested) || requested <= 0) {
    res.status(400).json({ message: "points must be a positive integer" })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: ["id", "customer_id", "currency_code", "subtotal", "total"],
    filters: { id: cartId },
  })
  // `subtotal` / `total` are computed virtual fields available at runtime
  // but not in the static remote-query type; cast to `any` to read them.
  const cart = carts?.[0] as
    | (typeof carts[number] & { subtotal?: number; total?: number })
    | undefined

  if (!cart) {
    res.status(404).json({ message: `Cart ${cartId} not found` })
    return
  }

  if (cart.customer_id && cart.customer_id !== customerId) {
    res.status(403).json({ message: "This cart does not belong to you" })
    return
  }

  const currency = (cart.currency_code ?? "").toLowerCase()
  if (currency !== "mur") {
    res.status(400).json({
      message: "Doll Rewards redemption is only available in MUR",
    })
    return
  }

  const subtotal = Number(cart.subtotal ?? 0)
  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    res.status(400).json({ message: "Cart has no subtotal to discount" })
    return
  }

  const loyaltyService = req.scope.resolve<LoyaltyModuleService>(LOYALTY_MODULE)
  const settings = await loyaltyService.getSettings()
  const account = await loyaltyService.getAccount(customerId)

  const maxRedeemable = calculateMaxRedeemablePoints(
    account.points_balance,
    subtotal,
    settings,
  )
  const requestedInt = Math.floor(requested)
  const willRedeem =
    requestedInt >= settings.min_redeem_points
      ? Math.min(requestedInt, maxRedeemable)
      : 0
  const discountMur = calculateRedemptionDiscount(willRedeem, settings)

  res.json({
    loyalty: {
      points_balance: account.points_balance,
      max_redeemable: maxRedeemable,
      requested_points: willRedeem,
      discount_mur: discountMur,
      balance_after: account.points_balance - willRedeem,
      min_redeem_points: settings.min_redeem_points,
      redeem_rate_mur_per_100_pts: settings.redeem_rate_mur_per_100_pts,
    },
  })
}
