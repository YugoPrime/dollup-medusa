import type {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createPreorderProduct } from "../../admin/preorder/lib/create-preorder-product"
import { PREORDER_MODULE } from "../../../modules/preorder"
import type PreorderModuleService from "../../../modules/preorder/service"

/**
 * POST /hooks/preorder-bookmarklet
 *
 * Token-authed endpoint that accepts the multi-color SHEIN payload scraped
 * by the bookmarklet from a product page and creates a Medusa pre-order
 * product. Lives under /hooks/* (not /admin/* or /store/*) because Medusa
 * registers global per-namespace auth/publishable-key middleware on those
 * two namespaces that can't be opted out per-route. /hooks/* has no
 * built-in auth, no built-in CORS — our middleware adds the CORS headers
 * explicitly. Auth here is the custom header-based shared token verified
 * against the preorder_token table.
 */
type BookmarkletBody = {
  title?: string
  sheinUrl?: string
  sheinPriceUsd?: number
  description?: string
  sizes?: string[]
  colors?: Array<{
    name?: string
    sheinUrl?: string
    sheinGoodsId?: string
    images?: string[]
  }>
  bookmarkletVersion?: string
}

const STOREFRONT_URL =
  process.env.PREORDER_STOREFRONT_URL ?? "https://preorder.dollupboutique.com"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const PREORDER_SALES_CHANNEL_ID = process.env.PREORDER_SALES_CHANNEL_ID
  if (!PREORDER_SALES_CHANNEL_ID) {
    res.status(500).json({
      message:
        "PREORDER_SALES_CHANNEL_ID env var is not set on the backend. Cannot create pre-order products without a sales channel binding.",
    })
    return
  }

  const token = req.headers["x-preorder-bookmarklet-token"]
  const tokenStr = Array.isArray(token) ? token[0] : token
  if (!tokenStr || typeof tokenStr !== "string") {
    res.status(401).json({
      message: "missing x-preorder-bookmarklet-token header",
    })
    return
  }

  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  const verifyResult = await svc.verifyBookmarkletToken(tokenStr)
  if (!verifyResult.valid) {
    res.status(401).json({ message: `token ${verifyResult.reason}` })
    return
  }

  const body = (req.body ?? {}) as BookmarkletBody

  // Required-field validation. Deep validation (image URL hosts, color
  // structure, size dedup, etc.) is done inside createPreorderProduct's
  // validateBookmarkletInput — we only check the absolute basics here so
  // we can return a clean 400 fast.
  if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
    res.status(400).json({ message: "title required" })
    return
  }
  if (!body.sheinUrl || typeof body.sheinUrl !== "string") {
    res.status(400).json({ message: "sheinUrl required" })
    return
  }
  if (!/^https?:\/\/(?:[a-z]+\.)?shein\.com\//i.test(body.sheinUrl)) {
    res.status(400).json({ message: "sheinUrl must be a shein.com URL" })
    return
  }
  if (
    typeof body.sheinPriceUsd !== "number" ||
    !Number.isFinite(body.sheinPriceUsd) ||
    body.sheinPriceUsd <= 0
  ) {
    res
      .status(400)
      .json({ message: "sheinPriceUsd must be a positive number" })
    return
  }
  if (!Array.isArray(body.colors) || body.colors.length === 0) {
    res.status(400).json({ message: "colors: at least one color required" })
    return
  }
  for (const c of body.colors) {
    if (!c || typeof c !== "object") {
      res.status(400).json({ message: "each color must be an object" })
      return
    }
    if (!c.name || typeof c.name !== "string") {
      res.status(400).json({ message: "color.name required" })
      return
    }
    if (!c.sheinUrl || typeof c.sheinUrl !== "string") {
      res.status(400).json({ message: "color.sheinUrl required" })
      return
    }
    if (!c.sheinGoodsId || typeof c.sheinGoodsId !== "string") {
      res.status(400).json({ message: "color.sheinGoodsId required" })
      return
    }
    if (!Array.isArray(c.images) || c.images.length === 0) {
      res
        .status(400)
        .json({ message: `color "${c.name}" must have at least one image` })
      return
    }
  }

  const sizes =
    Array.isArray(body.sizes) && body.sizes.length > 0
      ? body.sizes
      : ["One Size"]

  try {
    const result = await createPreorderProduct(
      req.scope,
      {
        title: body.title,
        sheinUrl: body.sheinUrl,
        sheinPriceUsd: body.sheinPriceUsd,
        description: body.description,
        sizes,
        colors: body.colors.map((c) => ({
          name: c.name!,
          sheinUrl: c.sheinUrl!,
          sheinGoodsId: c.sheinGoodsId,
          images: c.images!,
        })),
        bookmarkletVersion: body.bookmarkletVersion,
      },
      PREORDER_SALES_CHANNEL_ID,
      // NOTE: do NOT pass allowAnyImageHost — bookmarklet must only ship
      // SHEIN CDN (img.ltwebstatic.com) URLs. The helper's default
      // validator enforces this.
    )

    const storefrontUrl = `${STOREFRONT_URL}/preorder/products/${result.product.handle}`

    res.json({
      product: result.product,
      storefrontUrl,
      preview: result.preview,
    })
  } catch (err: any) {
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as any
    logger.warn?.(
      `[hooks/preorder-bookmarklet POST] create failed: ${err?.message ?? err}`,
    )
    // Validation failures from the helper are 400; channel-link orphan errors
    // are 500. Same mapping as src/api/admin/preorder/products/route.ts.
    const isOrphan = err?.message?.includes("failed to link to Pre-Order")
    res
      .status(isOrphan ? 500 : 400)
      .json({ message: err?.message ?? "create failed" })
  }
}
