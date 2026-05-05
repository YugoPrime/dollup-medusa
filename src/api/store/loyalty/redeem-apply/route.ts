import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

import { LOYALTY_MODULE } from "../../../../modules/loyalty"
import type LoyaltyModuleService from "../../../../modules/loyalty/service"
import {
  applyLoyaltyDiscountToCart,
  calculateMaxRedeemablePoints,
  calculateRedemptionDiscount,
  readLoyaltyRedeemMetadata,
} from "../../../../workflows/apply-loyalty-discount"

/**
 * Apply a redemption to a cart.
 *
 * POST /store/loyalty/redeem-apply
 * body: { cart_id: string, points: number }
 *
 * The route validates ownership/currency/caps, adds a real Medusa cart
 * adjustment, burns the points, and stamps cart.metadata.loyalty_redeem.
 *
 * If checkout abandons, the points remain burned for the MVP. A future
 * redeem-cancel endpoint can reverse that explicitly.
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
    fields: [
      "id",
      "customer_id",
      "currency_code",
      "subtotal",
      "total",
      "metadata",
    ],
    filters: { id: cartId },
  })
  const cart = carts?.[0] as
    | (typeof carts[number] & {
        subtotal?: number
        total?: number
        metadata?: Record<string, unknown> | null
      })
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

  const existingMetadata = (cart.metadata ?? {}) as Record<string, unknown>
  if (readLoyaltyRedeemMetadata(existingMetadata)) {
    res.status(409).json({
      message: "A loyalty redemption is already applied to this cart",
    })
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

  if (requestedInt < settings.min_redeem_points) {
    res.status(400).json({
      message: `Minimum redemption is ${settings.min_redeem_points} points`,
      min_redeem_points: settings.min_redeem_points,
    })
    return
  }

  if (requestedInt > maxRedeemable) {
    res.status(400).json({
      message: "Requested points exceed the redeemable cap",
      max_redeemable: maxRedeemable,
    })
    return
  }

  const discountMur = calculateRedemptionDiscount(requestedInt, settings)
  if (discountMur <= 0) {
    res.status(400).json({ message: "Nothing to redeem" })
    return
  }

  await applyLoyaltyDiscountToCart({
    cartId: cart.id,
    discountMur,
    container: req.scope,
  })

  await loyaltyService.redeemPoints(customerId, requestedInt, {
    reason: `Redeemed at checkout for cart ${cart.id}`,
  })

  const cartModuleService = req.scope.resolve(Modules.CART)
  const newMetadata = {
    ...existingMetadata,
    loyalty_redeem: {
      points: requestedInt,
      discount_mur: discountMur,
      applied_at: new Date().toISOString(),
      customer_id: customerId,
      redeem_rate_mur_per_100_pts: settings.redeem_rate_mur_per_100_pts,
    },
  }
  await cartModuleService.updateCarts(cart.id, { metadata: newMetadata })

  const updatedAccount = await loyaltyService.getAccount(customerId)

  res.json({
    loyalty: {
      cart_id: cart.id,
      points_redeemed: requestedInt,
      discount_mur: discountMur,
      balance_after: updatedAccount.points_balance,
    },
  })
}
