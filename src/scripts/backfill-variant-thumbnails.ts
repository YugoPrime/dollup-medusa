/**
 * Backfills `product_variant.thumbnail` from the variant's own colour imagery.
 *
 * Root cause it repairs: Medusa's `prepareLineItemData` stamps a line item's
 * thumbnail as `variant.thumbnail ?? variant.product.thumbnail`. Every variant
 * in this catalog had a NULL `thumbnail` column, so a "Yellow / L" line showed
 * the product's default (white) shot in the cart drawer, checkout, the
 * order-placed email and the customer's order history — even though the PDP
 * gallery swapped correctly off `variant.metadata.image_urls`.
 *
 * The creation paths are fixed (sourcing push + pre-order bookmarklet). This
 * script repairs the variants already in the DB.
 *
 * Idempotent: only variants with a usable `metadata.image_urls[0]` AND a
 * thumbnail that doesn't already match are touched.
 *
 * Note: line items are SNAPSHOTS. Orders already placed and carts already
 * holding the item keep the old thumbnail; they self-heal on the next add.
 *
 * Run it against the prod DB from your machine (NEVER `medusa exec` inside the
 * prod container — it boots a second Medusa and OOMs PID 1):
 *   set -a; . ./.env.local-render; set +a
 *   yarn medusa exec ./src/scripts/backfill-variant-thumbnails.ts              # DRY RUN
 *   APPLY=true yarn medusa exec ./src/scripts/backfill-variant-thumbnails.ts   # WRITE
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import { pickVariantThumbnail } from "../lib/variant-thumbnail"

type VariantRow = {
  id: string
  title?: string | null
  thumbnail?: string | null
  metadata?: Record<string, unknown> | null
  product?: { title?: string | null } | null
}

export default async function backfillVariantThumbnails({
  container,
  args,
}: ExecArgs) {
  const apply = process.env.APPLY === "true" || (args ?? []).includes("--apply")
  const logger = container.resolve("logger")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: variants } = (await query.graph({
    entity: "product_variant",
    fields: ["id", "title", "thumbnail", "metadata", "product.title"],
  })) as unknown as { data: VariantRow[] }

  const updates: { id: string; thumbnail: string }[] = []
  let noImagery = 0
  let alreadyOk = 0

  for (const v of variants) {
    const wanted = pickVariantThumbnail(v.metadata)
    if (!wanted) {
      noImagery++
      continue
    }
    if (v.thumbnail === wanted) {
      alreadyOk++
      continue
    }
    logger.info(
      `[variant-thumbs] ${v.product?.title ?? "?"} / ${v.title ?? "?"}: ` +
        `${v.thumbnail ?? "NULL"} -> ${wanted}`,
    )
    updates.push({ id: v.id, thumbnail: wanted })
  }

  logger.info(
    `[variant-thumbs] scanned ${variants.length} variants — ` +
      `${updates.length} to fix, ${alreadyOk} already correct, ` +
      `${noImagery} without per-colour imagery.`,
  )

  if (updates.length === 0) {
    logger.info("[variant-thumbs] nothing to fix. done.")
    return
  }

  if (!apply) {
    logger.info(
      "[variant-thumbs] DRY RUN — re-run with APPLY=true to write these changes.",
    )
    return
  }

  // Chunked: the catalog runs to thousands of variants and the workflow builds
  // one transaction per run.
  const CHUNK = 200
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK)
    await updateProductVariantsWorkflow(container).run({
      input: { product_variants: slice },
    })
    logger.info(
      `[variant-thumbs] applied ${i + slice.length}/${updates.length}…`,
    )
  }
  logger.info(`[variant-thumbs] applied ${updates.length} thumbnail(s). done.`)
}
