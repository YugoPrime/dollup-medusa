import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"

import { PREORDER_MODULE } from "../../../../modules/preorder"
import type PreorderModuleService from "../../../../modules/preorder/service"

const PREORDER_SHIPPING_PROFILE_NAME = "Pre-Order Shipping"
const SHEIN_CDN_REGEX = /^https:\/\/img\.ltwebstatic\.com\//

export type CreatePreorderColor = {
  name: string
  sheinUrl: string
  sheinGoodsId: string
  images: string[]
}

export type CreatePreorderProductInput = {
  title: string
  sheinUrl: string  // the URL where the bookmarklet was clicked
  sheinPriceUsd: number
  description?: string
  sizes: string[]
  colors: CreatePreorderColor[]
  bookmarkletVersion?: string
}

export type CreatePreorderProductResult = {
  product: { id: string; handle: string }
  preview: {
    sheinPriceMur: number
    finalPriceMur: number
    fxRateUsed: number
  }
  variantCount: number
  colorCount: number
}

/**
 * Pure input validator. Exported separately so it can be unit-tested without
 * spinning up the container.
 */
export function validateBookmarkletInput(input: unknown): asserts input is CreatePreorderProductInput {
  if (!input || typeof input !== "object") throw new Error("input must be an object")
  const i = input as Record<string, any>
  if (!i.title || typeof i.title !== "string") throw new Error("title required")
  if (!i.sheinUrl || typeof i.sheinUrl !== "string") throw new Error("sheinUrl required")
  if (!/(^https?:\/\/)(m\.)?shein\.com\//i.test(i.sheinUrl)) {
    throw new Error("sheinUrl must be a shein.com URL")
  }
  if (typeof i.sheinPriceUsd !== "number" || !(i.sheinPriceUsd > 0)) {
    throw new Error("sheinPriceUsd must be a positive number")
  }
  if (!Array.isArray(i.sizes) || i.sizes.length === 0) {
    throw new Error("sizes: at least one size required")
  }
  for (const s of i.sizes) {
    if (typeof s !== "string" || !s.trim()) throw new Error("sizes[] must be non-empty strings")
  }
  if (!Array.isArray(i.colors) || i.colors.length === 0) {
    throw new Error("colors: at least one color required")
  }
  for (const c of i.colors) {
    if (!c || typeof c !== "object") throw new Error("each color must be an object")
    if (!c.name || typeof c.name !== "string") throw new Error("color.name required")
    if (!c.sheinUrl || typeof c.sheinUrl !== "string") throw new Error("color.sheinUrl required")
    if (!c.sheinGoodsId || typeof c.sheinGoodsId !== "string") throw new Error("color.sheinGoodsId required")
    if (!Array.isArray(c.images) || c.images.length === 0) {
      throw new Error(`color "${c.name}" must have at least one image`)
    }
    for (const url of c.images) {
      if (typeof url !== "string" || !SHEIN_CDN_REGEX.test(url)) {
        throw new Error(`color "${c.name}" image URLs must be on img.ltwebstatic.com`)
      }
    }
  }
}

/**
 * Runs the full create + sales-channel-link flow for a multi-color pre-order
 * product. Each color contributes its own variant.metadata.image_urls so the
 * storefront PDP gallery can swap on color change.
 */
export async function createPreorderProduct(
  container: MedusaContainer,
  rawInput: unknown,
  preorderSalesChannelId: string,
): Promise<CreatePreorderProductResult> {
  validateBookmarkletInput(rawInput)
  const input = rawInput as CreatePreorderProductInput

  const svc = container.resolve<PreorderModuleService>(PREORDER_MODULE)
  const preview = await svc.previewPrice({ sheinPriceUsd: input.sheinPriceUsd })
  const settings = await svc.getSettings()

  const fulfillmentService = container.resolve(Modules.FULFILLMENT)
  const [preorderProfile] = await fulfillmentService.listShippingProfiles({
    name: PREORDER_SHIPPING_PROFILE_NAME,
  })
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any
  if (!preorderProfile) {
    logger.warn?.(
      `[create-preorder-product] Pre-Order shipping profile not found.`,
    )
  }

  const variants = input.colors.flatMap((color) =>
    input.sizes.map((size) => ({
      title: `${color.name} / ${size}`,
      sku: undefined,
      options: { Color: color.name, Size: size },
      prices: [{ currency_code: "mur", amount: preview.finalPriceMur * 100 }],
      manage_inventory: false,
      metadata: {
        image_urls: color.images,
        shein_url: color.sheinUrl,
        shein_goods_id: color.sheinGoodsId,
      },
    })),
  )

  const handle =
    input.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") +
    "-preorder-" +
    Date.now().toString(36)

  const productImages = input.colors.flatMap((c) =>
    c.images.map((url) => ({ url })),
  )
  const thumbnail = input.colors[0].images[0]

  const result = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: input.title,
          handle,
          description: input.description ?? "",
          status: "published",
          images: productImages,
          thumbnail,
          options: [
            { title: "Color", values: input.colors.map((c) => c.name) },
            { title: "Size", values: input.sizes },
          ],
          variants,
          metadata: {
            is_preorder: true,
            shein_url: input.sheinUrl,
            shein_price_usd: input.sheinPriceUsd,
            preorder_fx_rate: preview.fxRateUsed,
            preorder_eta_min_days: settings.eta_min_days,
            preorder_eta_max_days: settings.eta_max_days,
            preorder_priced_at: new Date().toISOString(),
            bookmarklet_version: input.bookmarkletVersion ?? null,
          },
          sales_channels: [{ id: preorderSalesChannelId }],
          ...(preorderProfile ? { shipping_profile_id: preorderProfile.id } : {}),
        },
      ],
    },
  })

  const created = (result.result as Array<{ id: string; handle: string }>)[0]

  // Explicit channel link — see 2026-05-27 fix in memory for why the workflow
  // input alone silently no-ops.
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
  try {
    await remoteLink.create({
      [Modules.PRODUCT]: { product_id: created.id },
      [Modules.SALES_CHANNEL]: {
        sales_channel_id: preorderSalesChannelId,
      },
    })
  } catch (err: any) {
    if (
      !err?.message?.includes("already exists") &&
      !err?.message?.includes("duplicate") &&
      err?.code !== "23505"
    ) {
      logger.warn?.(
        `[create-preorder-product] channel link failed for ${created.id}: ${err?.message ?? err}`,
      )
    }
  }

  return {
    product: { id: created.id, handle: created.handle },
    preview,
    variantCount: variants.length,
    colorCount: input.colors.length,
  }
}
