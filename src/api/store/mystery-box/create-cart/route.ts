import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import {
  addToCartWorkflow,
  createCartWorkflow,
} from "@medusajs/medusa/core-flows"

import {
  applyMysteryBoxDiscountToCart,
  moneyNumber,
  MYSTERY_BOX_FLAT_PRICE_MUR,
  type MysteryBoxMetadata,
} from "../../../../workflows/apply-mystery-box-discount"

const SLOT_COUNT = 5
const MAX_SIZE_LENGTH = 8

type CreateCartBody = {
  region_id?: unknown
  size?: unknown
  slots?: unknown
}

type ProductVariantForBox = {
  id: string
  sku?: string | null
  title?: string | null
  manage_inventory?: boolean | null
  allow_backorder?: boolean | null
  inventory_quantity?: number | null
  options?: Array<{ value?: string | null }>
  product?: {
    id: string
    title?: string | null
    discountable?: boolean | null
  } | null
}

function generateBoxId(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  const rand = Math.random().toString(36).slice(2, 6)
  return `MB-${y}-${m}-${d}-${rand}`
}

export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const customerId = req.auth_context?.actor_id ?? null
  const body = (req.body ?? {}) as CreateCartBody

  const regionId = typeof body.region_id === "string" ? body.region_id : ""
  const size = typeof body.size === "string" ? body.size.trim() : ""
  const rawSlots = Array.isArray(body.slots) ? body.slots : []

  if (!regionId) {
    res.status(400).json({ message: "region_id is required" })
    return
  }
  if (!size || size.length > MAX_SIZE_LENGTH) {
    res.status(400).json({ message: "size is required and must be <= 8 chars" })
    return
  }
  if (rawSlots.length !== SLOT_COUNT) {
    res
      .status(400)
      .json({ message: `slots must have exactly ${SLOT_COUNT} entries` })
    return
  }

  const variantIds: string[] = []
  for (const slot of rawSlots) {
    if (
      !slot ||
      typeof slot !== "object" ||
      typeof (slot as { variant_id?: unknown }).variant_id !== "string"
    ) {
      res
        .status(400)
        .json({ message: "each slot must be { variant_id: string }" })
      return
    }
    variantIds.push((slot as { variant_id: string }).variant_id)
  }

  const variantQuantities = new Map<string, number>()
  for (const variantId of variantIds) {
    variantQuantities.set(variantId, (variantQuantities.get(variantId) ?? 0) + 1)
  }
  const uniqueVariantIds = [...variantQuantities.keys()]

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "currency_code"],
    filters: { id: regionId },
  })
  const region = regions?.[0]

  if (!region) {
    res.status(404).json({ message: `Region ${regionId} not found` })
    return
  }
  if ((region.currency_code ?? "").toLowerCase() !== "mur") {
    res.status(400).json({ message: "Mystery Box is only available in MUR" })
    return
  }

  // `inventory_quantity` is not a real column on product_variant — it is
  // hydrated through the product → inventory module link. Querying
  // entity:"product_variant" returns it undefined, which falsely flags every
  // managed variant as out of stock. Route through the product entity instead,
  // matching the storefront's sdk.store.product.list path.
  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "discountable",
      "variants.id",
      "variants.sku",
      "variants.title",
      "variants.manage_inventory",
      "variants.allow_backorder",
      "variants.inventory_quantity",
      "variants.options.value",
    ],
    filters: { variants: { id: uniqueVariantIds } },
  })

  const requestedVariantIds = new Set(uniqueVariantIds)
  const variants: ProductVariantForBox[] = []
  for (const product of (products ?? []) as Array<{
    id: string
    title?: string | null
    discountable?: boolean | null
    variants?: Array<{
      id: string
      sku?: string | null
      title?: string | null
      manage_inventory?: boolean | null
      allow_backorder?: boolean | null
      inventory_quantity?: number | null
      options?: Array<{ value?: string | null }>
    }> | null
  }>) {
    for (const variant of product.variants ?? []) {
      if (!requestedVariantIds.has(variant.id)) continue
      variants.push({
        id: variant.id,
        sku: variant.sku ?? null,
        title: variant.title ?? null,
        manage_inventory: variant.manage_inventory ?? null,
        allow_backorder: variant.allow_backorder ?? null,
        inventory_quantity: variant.inventory_quantity ?? null,
        options: variant.options,
        product: {
          id: product.id,
          title: product.title ?? null,
          discountable: product.discountable ?? null,
        },
      })
    }
  }

  if (variants.length !== uniqueVariantIds.length) {
    res.status(404).json({ message: "One or more variants not found" })
    return
  }

  const requestedSizeUpper = size.toUpperCase()
  const wrongSize: string[] = []
  const notDiscountable: string[] = []

  // Stock is enforced by addToCartWorkflow further down — that is Medusa's
  // canonical stock check and uses the inventory module directly. Pre-checking
  // inventory_quantity here via query.graph proved unreliable because the
  // product → inventory link doesn't always hydrate that virtual field on a
  // graph traversal, leading to false 409s even when the storefront listing
  // showed the variants in stock.
  for (const variant of variants) {
    if (variant.product?.discountable === false) {
      notDiscountable.push(variant.id)
    }

    const matchesSize = (variant.options ?? []).some((option) => {
      return option.value?.trim().toUpperCase() === requestedSizeUpper
    })
    if (!matchesSize) {
      wrongSize.push(variant.id)
    }
  }

  if (wrongSize.length > 0) {
    res.status(400).json({
      message: "Some items do not match the requested size",
      wrong_size_variant_ids: wrongSize,
    })
    return
  }
  if (notDiscountable.length > 0) {
    res.status(400).json({
      message: "Some items are not discountable",
      not_discountable_variant_ids: notDiscountable,
    })
    return
  }

  const { result: createdCart } = await createCartWorkflow(req.scope).run({
    input: {
      region_id: regionId,
      customer_id: customerId ?? undefined,
      sales_channel_id: req.publishable_key_context?.sales_channel_ids?.[0],
    },
  })
  const cartId = (createdCart as { id: string }).id

  try {
    await addToCartWorkflow(req.scope).run({
      input: {
        cart_id: cartId,
        items: [...variantQuantities.entries()].map(([variantId, quantity]) => ({
          variant_id: variantId,
          quantity,
        })),
      },
    })

    const { data: carts } = await query.graph({
      entity: "cart",
      fields: ["id", "subtotal", "metadata"],
      filters: { id: cartId },
    })
    const cart = carts?.[0] as
      | {
          id: string
          subtotal?: number | string | { value?: string | number } | null
          metadata?: Record<string, unknown> | null
        }
      | undefined
    const originalSubtotal = Math.floor(moneyNumber(cart?.subtotal))

    if (!cart || originalSubtotal <= 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Mystery Box cart has no subtotal",
      )
    }
    if (originalSubtotal < MYSTERY_BOX_FLAT_PRICE_MUR) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Box value is below the flat price of Rs ${MYSTERY_BOX_FLAT_PRICE_MUR}`,
      )
    }

    const boxId = generateBoxId()
    const appliedAt = new Date().toISOString()
    const mysteryBox: MysteryBoxMetadata = {
      id: boxId,
      size: requestedSizeUpper,
      flat_price_mur: MYSTERY_BOX_FLAT_PRICE_MUR,
      original_subtotal_mur: originalSubtotal,
      applied_at: appliedAt,
    }

    const cartModuleService = req.scope.resolve(Modules.CART) as {
      updateCarts: (
        cartId: string,
        data: { metadata?: Record<string, unknown> },
      ) => Promise<unknown>
    }
    await cartModuleService.updateCarts(cart.id, {
      metadata: {
        ...(cart.metadata ?? {}),
        mystery_box: mysteryBox,
      },
    })

    await applyMysteryBoxDiscountToCart({
      cartId,
      container: req.scope,
    })

    res.json({
      cart_id: cartId,
      mystery_box: mysteryBox,
    })
  } catch (err) {
    const cartModule = req.scope.resolve(Modules.CART) as {
      softDeleteCarts: (ids: string[]) => Promise<void>
    }
    await cartModule.softDeleteCarts([cartId]).catch(() => undefined)

    // addToCartWorkflow throws when a managed, non-backorderable variant
    // can't satisfy the requested quantity. Surface that as a 409 (matching
    // the previous shape so the storefront can keep its existing error UI).
    const message = err instanceof Error ? err.message : ""
    if (/inventory|stock|not stocked|insufficient/i.test(message)) {
      res.status(409).json({
        message: "Some items are out of stock",
        detail: message,
      })
      return
    }

    if (err instanceof MedusaError) {
      throw err
    }
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      err instanceof Error ? err.message : "Failed to create Mystery Box cart",
    )
  }
}
