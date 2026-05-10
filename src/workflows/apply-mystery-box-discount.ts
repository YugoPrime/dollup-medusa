import type { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { refreshPaymentCollectionForCartWorkflow } from "@medusajs/medusa/core-flows"

export const MYSTERY_BOX_FLAT_PRICE_MUR = 3500
// We deliberately do NOT set `code` on the manual line-item adjustments —
// Medusa's promotion module strips every coded line-item adjustment whenever
// refreshCartItemsWorkflow runs (e.g. via cart.addShippingMethod / cart.update),
// even when the code matches no real promotion. Matching by `provider_id`
// instead keeps the adjustment invisible to that sweep.
export const MYSTERY_BOX_ADJUSTMENT_PROVIDER_ID = "mystery_box"
export const MYSTERY_BOX_ADJUSTMENT_DESCRIPTION =
  "Mystery Box flat-rate discount"

export type MysteryBoxMetadata = {
  id: string
  size: string
  flat_price_mur: number
  original_subtotal_mur: number
  applied_at: string
}

type CartAdjustment = {
  id?: string
  code?: string | null
  provider_id?: string | null
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

type MysteryBoxCart = {
  id: string
  subtotal?: number | string | { value?: string | number } | null
  metadata?: Record<string, unknown> | null
  items?: CartLineItem[]
}

export function readMysteryBoxMetadata(
  metadata: Record<string, unknown> | null | undefined,
): MysteryBoxMetadata | null {
  const raw = metadata?.mystery_box
  if (!raw || typeof raw !== "object") {
    return null
  }

  const record = raw as Record<string, unknown>
  const id = typeof record.id === "string" ? record.id : null
  const size = typeof record.size === "string" ? record.size : null
  const flatPrice = Number(record.flat_price_mur)
  const originalSubtotal = Number(record.original_subtotal_mur)
  const appliedAt =
    typeof record.applied_at === "string" ? record.applied_at : null

  if (
    !id ||
    !size ||
    !appliedAt ||
    !Number.isFinite(flatPrice) ||
    flatPrice <= 0 ||
    !Number.isFinite(originalSubtotal) ||
    originalSubtotal <= 0
  ) {
    return null
  }

  return {
    id,
    size,
    flat_price_mur: Math.floor(flatPrice),
    original_subtotal_mur: Math.floor(originalSubtotal),
    applied_at: appliedAt,
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

export function calculateMysteryBoxDiscount(
  subtotalMur: number,
  flatPriceMur: number = MYSTERY_BOX_FLAT_PRICE_MUR,
) {
  if (!Number.isFinite(subtotalMur) || subtotalMur <= 0) {
    return 0
  }
  if (subtotalMur <= flatPriceMur) {
    return 0
  }

  return Math.floor(subtotalMur - flatPriceMur)
}

export function buildMysteryBoxLineItemAdjustments(
  cart: MysteryBoxCart,
  discountMur: number,
) {
  let remaining = Math.floor(discountMur)
  const items = (cart.items ?? []).filter((item) => {
    return item.is_discountable !== false && getLineItemSubtotal(item) > 0
  })
  const adjustments: {
    item_id: string
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
      amount,
      description: MYSTERY_BOX_ADJUSTMENT_DESCRIPTION,
      provider_id: MYSTERY_BOX_ADJUSTMENT_PROVIDER_ID,
    })
    remaining -= amount
  }

  if (remaining > 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Mystery Box discount exceeds discountable cart subtotal",
    )
  }

  return adjustments
}

export function assertCartHasMysteryBoxDiscount(cart: MysteryBoxCart) {
  const meta = readMysteryBoxMetadata(cart.metadata)
  if (!meta) {
    return
  }

  const subtotal = moneyNumber(cart.subtotal)
  const expectedDiscount = calculateMysteryBoxDiscount(
    subtotal,
    meta.flat_price_mur,
  )
  if (expectedDiscount === 0) {
    return
  }

  const adjustmentTotal = (cart.items ?? [])
    .flatMap((item) => item.adjustments ?? [])
    .filter(
      (adjustment) =>
        adjustment.provider_id === MYSTERY_BOX_ADJUSTMENT_PROVIDER_ID,
    )
    .reduce((sum, adjustment) => sum + moneyNumber(adjustment.amount), 0)

  if (Math.floor(adjustmentTotal) !== expectedDiscount) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Mystery Box cart is missing its discount adjustment",
    )
  }
}

export async function applyMysteryBoxDiscountToCart({
  cartId,
  container,
  refreshPaymentCollection = true,
}: {
  cartId: string
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
  const cart = carts?.[0] as MysteryBoxCart | undefined

  if (!cart) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Cart ${cartId} not found`,
    )
  }

  const meta = readMysteryBoxMetadata(cart.metadata)
  if (!meta) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Cart has no mystery_box metadata",
    )
  }

  const subtotal = moneyNumber(cart.subtotal)
  const discount = calculateMysteryBoxDiscount(subtotal, meta.flat_price_mur)
  if (discount <= 0) {
    return
  }

  const cartModuleService = container.resolve(Modules.CART) as {
    softDeleteLineItemAdjustments: (ids: string[]) => Promise<void>
    addLineItemAdjustments: (
      cartId: string,
      adjustments: ReturnType<typeof buildMysteryBoxLineItemAdjustments>,
    ) => Promise<unknown>
  }

  const existingAdjustmentIds = (cart.items ?? [])
    .flatMap((item) => item.adjustments ?? [])
    .filter(
      (adjustment) =>
        adjustment.provider_id === MYSTERY_BOX_ADJUSTMENT_PROVIDER_ID,
    )
    .map((adjustment) => adjustment.id)
    .filter((id): id is string => Boolean(id))

  if (existingAdjustmentIds.length > 0) {
    await cartModuleService.softDeleteLineItemAdjustments(existingAdjustmentIds)
  }

  await cartModuleService.addLineItemAdjustments(
    cart.id,
    buildMysteryBoxLineItemAdjustments(cart, discount),
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

