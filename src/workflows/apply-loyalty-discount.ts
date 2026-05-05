import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import {
  completeCartWorkflow,
  refreshPaymentCollectionForCartWorkflow,
} from "@medusajs/medusa/core-flows"

import type { LoyaltySettingsDTO } from "../modules/loyalty/service"

export const LOYALTY_ADJUSTMENT_CODE = "DOLL_REWARDS"
export const LOYALTY_ADJUSTMENT_DESCRIPTION = "Doll Rewards redemption"

type LoyaltyRedeemMetadata = {
  points: number
  discount_mur: number
  applied_at?: string
  customer_id?: string
}

type CartAdjustment = {
  id?: string
  code?: string | null
  amount?: number | string | { value?: string | number } | null
}

type CartLineItem = {
  id: string
  quantity?: number | string | { value?: string | number } | null
  unit_price?: number | string | { value?: string | number } | null
  subtotal?: number | string | { value?: string | number } | null
  total?: number | string | { value?: string | number } | null
  is_discountable?: boolean
  adjustments?: CartAdjustment[]
}

type LoyaltyCart = {
  id: string
  subtotal?: number | string | { value?: string | number } | null
  metadata?: Record<string, unknown> | null
  items?: CartLineItem[]
}

export function readLoyaltyRedeemMetadata(
  metadata: Record<string, unknown> | null | undefined,
): LoyaltyRedeemMetadata | null {
  const raw = metadata?.loyalty_redeem
  if (!raw || typeof raw !== "object") {
    return null
  }

  const record = raw as Record<string, unknown>
  const points = Number(record.points)
  const discountMur = Number(record.discount_mur)

  if (
    !Number.isFinite(points) ||
    points <= 0 ||
    !Number.isFinite(discountMur) ||
    discountMur <= 0
  ) {
    return null
  }

  return {
    points: Math.floor(points),
    discount_mur: Math.floor(discountMur),
    applied_at:
      typeof record.applied_at === "string" ? record.applied_at : undefined,
    customer_id:
      typeof record.customer_id === "string" ? record.customer_id : undefined,
  }
}

export function moneyNumber(
  value: number | string | { value?: string | number } | null | undefined,
) {
  if (typeof value === "object" && value !== null && "value" in value) {
    return Number(value.value)
  }

  return Number(value ?? 0)
}

export function calculateRedemptionDiscount(
  points: number,
  settings: Pick<LoyaltySettingsDTO, "redeem_rate_mur_per_100_pts">,
) {
  if (
    !Number.isFinite(points) ||
    points <= 0 ||
    settings.redeem_rate_mur_per_100_pts <= 0
  ) {
    return 0
  }

  return Math.floor((Math.floor(points) * settings.redeem_rate_mur_per_100_pts) / 100)
}

export function calculateMaxRedeemablePoints(
  pointsBalance: number,
  subtotalMur: number,
  settings: Pick<
    LoyaltySettingsDTO,
    "min_redeem_points" | "redeem_rate_mur_per_100_pts"
  >,
) {
  if (
    pointsBalance < settings.min_redeem_points ||
    subtotalMur <= 0 ||
    settings.redeem_rate_mur_per_100_pts <= 0
  ) {
    return 0
  }

  const halfSubtotal = Math.floor(subtotalMur / 2)
  const subtotalPointCap = Math.floor(
    (halfSubtotal * 100) / settings.redeem_rate_mur_per_100_pts,
  )
  const capped = Math.max(0, Math.min(pointsBalance, subtotalPointCap))

  return capped >= settings.min_redeem_points ? capped : 0
}

export function buildLoyaltyLineItemAdjustments(
  cart: LoyaltyCart,
  discountMur: number,
) {
  let remaining = Math.floor(discountMur)
  const items = (cart.items ?? []).filter((item) => {
    return item.is_discountable !== false && getLineItemSubtotal(item) > 0
  })
  const adjustments: {
    item_id: string
    code: string
    amount: number
    description: string
    provider_id: string
  }[] = []

  for (const item of items) {
    if (remaining <= 0) {
      break
    }

    const amount = Math.min(remaining, getLineItemSubtotal(item))
    if (amount <= 0) {
      continue
    }

    adjustments.push({
      item_id: item.id,
      code: LOYALTY_ADJUSTMENT_CODE,
      amount,
      description: LOYALTY_ADJUSTMENT_DESCRIPTION,
      provider_id: "loyalty",
    })
    remaining -= amount
  }

  if (remaining > 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Loyalty discount exceeds discountable cart subtotal",
    )
  }

  return adjustments
}

export function assertCartHasLoyaltyDiscount(cart: LoyaltyCart) {
  const redemption = readLoyaltyRedeemMetadata(cart.metadata)
  if (!redemption) {
    return
  }

  const subtotal = moneyNumber(cart.subtotal)
  if (redemption.discount_mur > subtotal) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Loyalty redemption exceeds cart subtotal",
    )
  }

  const loyaltyAdjustmentTotal = (cart.items ?? [])
    .flatMap((item) => item.adjustments ?? [])
    .filter((adjustment) => adjustment.code === LOYALTY_ADJUSTMENT_CODE)
    .reduce((sum, adjustment) => sum + moneyNumber(adjustment.amount), 0)

  if (Math.floor(loyaltyAdjustmentTotal) !== redemption.discount_mur) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Loyalty redemption is missing its cart discount adjustment",
    )
  }
}

export async function applyLoyaltyDiscountToCart({
  cartId,
  discountMur,
  container,
  refreshPaymentCollection = true,
}: {
  cartId: string
  discountMur: number
  container: MedusaContainer
  refreshPaymentCollection?: boolean
}) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "subtotal",
      "metadata",
      "items.*",
      "items.adjustments.*",
    ],
    filters: { id: cartId },
  })
  const cart = carts?.[0] as LoyaltyCart | undefined

  if (!cart) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Cart ${cartId} not found`,
    )
  }

  const subtotal = moneyNumber(cart.subtotal)
  if (discountMur > subtotal) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Loyalty redemption exceeds cart subtotal",
    )
  }

  const cartModuleService = container.resolve(Modules.CART) as {
    softDeleteLineItemAdjustments: (ids: string[]) => Promise<void>
    addLineItemAdjustments: (
      cartId: string,
      adjustments: ReturnType<typeof buildLoyaltyLineItemAdjustments>,
    ) => Promise<unknown>
  }

  const existingAdjustmentIds = (cart.items ?? [])
    .flatMap((item) => item.adjustments ?? [])
    .filter((adjustment) => adjustment.code === LOYALTY_ADJUSTMENT_CODE)
    .map((adjustment) => adjustment.id)
    .filter((id): id is string => Boolean(id))

  if (existingAdjustmentIds.length > 0) {
    await cartModuleService.softDeleteLineItemAdjustments(existingAdjustmentIds)
  }

  await cartModuleService.addLineItemAdjustments(
    cart.id,
    buildLoyaltyLineItemAdjustments(cart, discountMur),
  )

  if (refreshPaymentCollection) {
    await refreshPaymentCollectionForCartWorkflow(container).run({
      input: { cart_id: cart.id },
    })
  }
}

function getLineItemSubtotal(item: CartLineItem) {
  const subtotal = moneyNumber(item.subtotal ?? item.total)
  if (subtotal > 0) {
    return Math.floor(subtotal)
  }

  return Math.max(
    0,
    Math.floor(moneyNumber(item.unit_price) * moneyNumber(item.quantity ?? 1)),
  )
}

completeCartWorkflow.hooks.validate(async ({ cart }) => {
  assertCartHasLoyaltyDiscount(cart as LoyaltyCart)
})
