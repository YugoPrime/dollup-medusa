/**
 * DollUp Boutique — Backfill: link existing pre-order products to the
 * Pre-Order sales channel.
 *
 * Background: products created via POST /admin/preorder/products were
 * supposed to be linked to the Pre-Order sales channel by
 * createProductsWorkflow's `sales_channels` input, but in practice the
 * link came out empty ("Available in 0 of 2 sales channels" on the
 * product page in admin). This script finds every product with
 * metadata.is_preorder === true and creates the missing link explicitly
 * via the remote link module — the same approach used by
 * link-products-shipping-profile.ts.
 *
 * Idempotent: skips products that already have the link.
 *
 * Run: yarn medusa exec ./src/scripts/link-preorder-products-to-channel.ts
 *
 * Requires env: PREORDER_SALES_CHANNEL_ID.
 */
import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"

export default async function linkPreorderProductsToChannel({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const productModuleService = container.resolve(Modules.PRODUCT)

  const PREORDER_SALES_CHANNEL_ID = process.env.PREORDER_SALES_CHANNEL_ID
  if (!PREORDER_SALES_CHANNEL_ID) {
    throw new Error(
      "PREORDER_SALES_CHANNEL_ID env var is required. Set it in the backend env, then re-run.",
    )
  }

  // 1. Find every product flagged as preorder via metadata.
  const allProducts = await productModuleService.listProducts(
    {},
    { take: 10000, select: ["id", "title", "metadata"] },
  )
  const preorderProducts = allProducts.filter((p) => {
    const meta = (p as { metadata?: Record<string, unknown> | null }).metadata
    return meta?.is_preorder === true
  })
  logger.info(`Found ${preorderProducts.length} preorder products (by metadata).`)

  if (preorderProducts.length === 0) {
    logger.info("Nothing to backfill.")
    return
  }

  // 2. Find existing product ↔ sales_channel links via the link table.
  //    Entity name is the linkable derived from product + sales_channel.
  const { data: existingLinks } = await query.graph({
    entity: "product_sales_channel",
    fields: ["product_id", "sales_channel_id"],
  })
  const alreadyLinked = new Set<string>(
    ((existingLinks ?? []) as Array<{
      product_id: string
      sales_channel_id: string
    }>)
      .filter((l) => l.sales_channel_id === PREORDER_SALES_CHANNEL_ID)
      .map((l) => l.product_id),
  )
  logger.info(
    `${alreadyLinked.size} preorder product(s) are already linked to channel ${PREORDER_SALES_CHANNEL_ID}.`,
  )

  // 3. Link the rest.
  const toLink = preorderProducts.filter((p) => !alreadyLinked.has(p.id))
  if (toLink.length === 0) {
    logger.info("All preorder products are already linked. Done.")
    return
  }
  logger.info(`Linking ${toLink.length} preorder product(s) to the channel...`)

  let linked = 0
  for (const p of toLink) {
    try {
      await link.create({
        [Modules.PRODUCT]: { product_id: p.id },
        [Modules.SALES_CHANNEL]: {
          sales_channel_id: PREORDER_SALES_CHANNEL_ID,
        },
      })
      linked++
      logger.info(`  ✓ ${p.id} (${(p as any).title})`)
    } catch (err) {
      logger.warn(
        `  ✗ ${p.id}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  logger.info(`Linked ${linked}/${toLink.length} product(s).`)
  logger.info("=== Done ===")
}
