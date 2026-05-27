import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { Modules, ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"

import { PREORDER_MODULE } from "../../../../modules/preorder"
import type PreorderModuleService from "../../../../modules/preorder/service"

const PREORDER_SHIPPING_PROFILE_NAME = "Pre-Order Shipping"

type CreatePreorderProductBody = {
  title: string
  sheinUrl: string
  sheinPriceUsd: number
  imageUrl: string
  description?: string
  colors?: string[]
  sizes?: string[]
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const PREORDER_SALES_CHANNEL_ID = process.env.PREORDER_SALES_CHANNEL_ID
  if (!PREORDER_SALES_CHANNEL_ID) {
    res.status(500).json({
      message:
        "PREORDER_SALES_CHANNEL_ID env var is not set on the backend. Cannot create pre-order products without a sales channel binding.",
    })
    return
  }

  const body = (req.body ?? {}) as Partial<CreatePreorderProductBody>

  const errors: string[] = []
  if (!body.title || typeof body.title !== "string") errors.push("title required")
  if (!body.sheinUrl || typeof body.sheinUrl !== "string") errors.push("sheinUrl required")
  if (typeof body.sheinPriceUsd !== "number" || !(body.sheinPriceUsd > 0)) {
    errors.push("sheinPriceUsd must be a positive number")
  }
  if (!body.imageUrl || typeof body.imageUrl !== "string") errors.push("imageUrl required")

  if (errors.length > 0) {
    res.status(400).json({ message: errors.join("; ") })
    return
  }

  if (!/(^https?:\/\/)(m\.)?shein\.com\//i.test(body.sheinUrl!)) {
    res.status(400).json({ message: "sheinUrl must be a https://shein.com or https://m.shein.com URL" })
    return
  }

  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const preview = await svc.previewPrice({ sheinPriceUsd: body.sheinPriceUsd! })
  const settings = await svc.getSettings()

  // Look up the Pre-Order shipping profile so the product's variants get the
  // correct fulfillment routing. Falls back to creating the product without an
  // explicit profile if setup-preorder-shipping.ts hasn't been run yet, in
  // which case the variant will land on the default profile and shipping at
  // checkout will silently use apex options. We log loudly so this is caught.
  const fulfillmentService = req.scope.resolve(Modules.FULFILLMENT)
  const [preorderProfile] = await fulfillmentService.listShippingProfiles({
    name: PREORDER_SHIPPING_PROFILE_NAME,
  })
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as any
  if (!preorderProfile) {
    logger.warn?.(
      `[preorder/products POST] Pre-Order shipping profile "${PREORDER_SHIPPING_PROFILE_NAME}" not found. Run yarn medusa exec ./src/scripts/setup-preorder-shipping.ts. Product will be created on the default shipping profile.`,
    )
  }

  const colors = body.colors?.length ? body.colors : ["Default"]
  const sizes = body.sizes?.length ? body.sizes : ["One Size"]

  const variants = colors.flatMap((color) =>
    sizes.map((size) => ({
      title: `${color} / ${size}`,
      sku: undefined,
      options: { Color: color, Size: size },
      prices: [{ currency_code: "mur", amount: preview.finalPriceMur * 100 }],
      manage_inventory: false,
    })),
  )

  const handle = body.title!
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") +
    "-preorder-" +
    Date.now().toString(36)

  const result = await createProductsWorkflow(req.scope).run({
    input: {
      products: [
        {
          title: body.title!,
          handle,
          description: body.description ?? "",
          status: "published",
          images: [{ url: body.imageUrl! }],
          thumbnail: body.imageUrl!,
          options: [
            { title: "Color", values: colors },
            { title: "Size", values: sizes },
          ],
          variants,
          metadata: {
            is_preorder: true,
            shein_url: body.sheinUrl!,
            shein_price_usd: body.sheinPriceUsd!,
            preorder_fx_rate: preview.fxRateUsed,
            preorder_eta_min_days: settings.eta_min_days,
            preorder_eta_max_days: settings.eta_max_days,
            preorder_priced_at: new Date().toISOString(),
          },
          sales_channels: [{ id: PREORDER_SALES_CHANNEL_ID }],
          ...(preorderProfile
            ? { shipping_profile_id: preorderProfile.id }
            : {}),
        },
      ],
    },
  })

  const created = (result.result as { id: string }[])[0]
  res.json({ product: created, preview })
}

/**
 * GET /admin/preorder/products
 *
 * Lists all preorder products (any status) for the admin list view. Filters
 * by the Pre-Order sales channel — since the channel is dedicated to preorder
 * products, channel membership is a reliable isolation gate (more reliable
 * than jsonb metadata filtering in Medusa v2 query.graph).
 *
 * Belt-and-suspenders: also checks metadata.is_preorder===true client-side so
 * a stray non-preorder product in the channel can't pollute the list.
 *
 * Returns lightweight fields — admin list only needs thumb, title, MUR price,
 * SHEIN URL (from metadata), status, created_at.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const PREORDER_SALES_CHANNEL_ID = process.env.PREORDER_SALES_CHANNEL_ID
  if (!PREORDER_SALES_CHANNEL_ID) {
    res.status(500).json({
      message: "PREORDER_SALES_CHANNEL_ID env var is not set on the backend.",
    })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const limit = Math.min(Number(req.query.limit ?? 100), 200)
  const offset = Math.max(Number(req.query.offset ?? 0), 0)

  // Filter products by sales-channel membership via the sales_channel entity.
  // Going the other direction (entity: "product", filters: { sales_channels: ... })
  // throws "Trying to query by not existing property Product.sales_channels" —
  // sales_channels is a module link, not a direct relation on Product.
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: [
      "products.id",
      "products.title",
      "products.handle",
      "products.thumbnail",
      "products.status",
      "products.created_at",
      "products.metadata",
      "products.variants.id",
      "products.variants.prices.amount",
      "products.variants.prices.currency_code",
    ],
    filters: { id: PREORDER_SALES_CHANNEL_ID } as any,
  })

  const allProducts: any[] = (channels[0] as any)?.products ?? []

  // Defense-in-depth: also filter by metadata.is_preorder so a stray
  // non-preorder product in the channel can't pollute the list.
  const filtered = allProducts.filter((p) => {
    const meta = (p?.metadata ?? null) as Record<string, unknown> | null
    return meta?.is_preorder === true
  })

  // Sort by created_at DESC, paginate client-side. The volume here is small
  // (preorder catalog is curated), so in-memory pagination is fine.
  filtered.sort((a, b) => {
    const ad = new Date(a.created_at ?? 0).getTime()
    const bd = new Date(b.created_at ?? 0).getTime()
    return bd - ad
  })

  const paginated = filtered.slice(offset, offset + limit)

  res.json({
    products: paginated,
    count: filtered.length,
    limit,
    offset,
  })
}
