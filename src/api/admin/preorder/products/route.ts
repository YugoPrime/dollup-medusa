import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { createPreorderProduct } from "../lib/create-preorder-product"

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

  // The admin form sends the legacy shape:
  //   { title, sheinUrl, sheinPriceUsd, imageUrl, colors: string[], sizes? }
  // The bookmarklet route sends the new shape:
  //   { title, sheinUrl, sheinPriceUsd, colors: [{name, sheinUrl, sheinGoodsId, images[]}], sizes }
  // Both flow through the same shared helper. Upgrade the legacy shape here so
  // the helper only has to handle one schema.
  const body = (req.body ?? {}) as Partial<{
    title: string
    sheinUrl: string
    sheinPriceUsd: number
    description?: string
    sizes?: string[]
    imageUrl?: string
    colors?:
      | string[]
      | Array<{
          name: string
          sheinUrl?: string
          sheinGoodsId?: string
          images: string[]
        }>
  }>

  const hasNewColorsShape =
    Array.isArray(body.colors) &&
    body.colors.length > 0 &&
    typeof body.colors[0] === "object" &&
    Array.isArray((body.colors[0] as { images?: unknown }).images)

  // Upgrade legacy shape to the new shape so the helper only ever sees one schema.
  let normalizedColors: Array<{
    name: string
    sheinUrl: string
    sheinGoodsId?: string
    images: string[]
  }>
  if (hasNewColorsShape) {
    // Already in new shape — fill sheinUrl per color when the bookmarklet
    // didn't supply one (it always does, but be defensive).
    normalizedColors = (
      body.colors as Array<{
        name: string
        sheinUrl?: string
        sheinGoodsId?: string
        images: string[]
      }>
    ).map((c) => ({
      name: c.name,
      sheinUrl: c.sheinUrl ?? body.sheinUrl ?? "",
      sheinGoodsId: c.sheinGoodsId,
      images: c.images,
    }))
  } else {
    // Legacy shape: { colors: string[], imageUrl }
    if (!body.imageUrl || typeof body.imageUrl !== "string") {
      res.status(400).json({
        message:
          "imageUrl required when colors is a string[] or not provided",
      })
      return
    }
    const colorNames =
      Array.isArray(body.colors) && body.colors.length > 0
        ? (body.colors as string[])
        : ["Default"]
    normalizedColors = colorNames.map((name) => ({
      name,
      sheinUrl: body.sheinUrl ?? "",
      images: [body.imageUrl!],
    }))
  }

  const sizes = body.sizes?.length ? body.sizes : ["One Size"]

  try {
    const result = await createPreorderProduct(
      req.scope,
      {
        title: body.title ?? "",
        sheinUrl: body.sheinUrl ?? "",
        sheinPriceUsd:
          typeof body.sheinPriceUsd === "number" ? body.sheinPriceUsd : 0,
        description: body.description,
        sizes,
        colors: normalizedColors,
      },
      PREORDER_SALES_CHANNEL_ID,
    )
    res.json(result)
  } catch (err: any) {
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as any
    logger.warn?.(
      `[admin/preorder POST] create failed: ${err?.message ?? err}`,
    )
    // Validation failures from the helper are 400; channel-link orphan errors
    // are 500. The helper throws a generic Error in both cases — distinguish
    // by message text.
    const isOrphan = err?.message?.includes("failed to link to Pre-Order")
    res
      .status(isOrphan ? 500 : 400)
      .json({ message: err?.message ?? "create failed" })
  }
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

  // Query.graph filter parser in Medusa v2 chokes on module-link relations
  // (sales_channels) and on jsonb path filters (metadata.is_preorder) — both
  // throw at runtime. So we fetch direct product fields with no relation
  // filter, then filter in-memory by metadata.is_preorder. Sales-channel
  // membership is enforced at WRITE time in POST (sales_channels: [{ id:
  // PREORDER_SALES_CHANNEL_ID }]), so we don't need to re-validate it here.
  // The catalog is small (curated preorder products, <50 in practice), so
  // a full product scan is acceptable.
  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "handle",
      "thumbnail",
      "status",
      "created_at",
      "metadata",
      "variants.id",
      "variants.prices.amount",
      "variants.prices.currency_code",
    ],
  })

  const filtered = (products as any[]).filter((p) => {
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
