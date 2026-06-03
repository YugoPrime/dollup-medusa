/**
 * Backfills the 100x price inflation introduced by the sourcing push pipeline.
 *
 * Root cause: src/modules/sourcing/service.ts wrote variant prices as
 * `Math.round(priceMur * 100)`, but this DB stores MUR as WHOLE RUPEES (the
 * apex catalog stores 800/1100/890, and the storefront's formatPrice never
 * divides by 100). Every product pushed through the wizard shipped at 100x —
 * e.g. a Rs 1,040 dress stored as 104000 and shown as "Rs 104,000".
 *
 * The code path is fixed at service.ts:~1078. This script repairs the rows
 * already written. Only MUR prices that are clearly inflated (>= THRESHOLD)
 * are divided by 100, so the script is idempotent — re-running after a fix
 * leaves already-corrected (sub-threshold) prices untouched.
 *
 * Scope: every variant in the Pre-Order sales channel. Apex products were
 * imported by a different path (whole rupees) and are NOT inflated, so even if
 * one were matched it would be sub-threshold and skipped.
 *
 * Dry-run (default): yarn medusa exec ./src/scripts/fix-sourcing-price-100x.ts
 * Apply:             APPLY=true yarn medusa exec ./src/scripts/fix-sourcing-price-100x.ts
 *
 * (Apply is gated on the APPLY env var, not a CLI flag: `medusa exec` strips
 * everything after `--` and rejects unknown flags, so `-- --apply` never
 * reaches the script. The env var is the reliable cross-platform trigger.)
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows"

// A real Doll Up dress is well under Rs 10,000. Anything at or above this is
// a 100x artifact (smallest real price 800 -> inflated 80,000).
const INFLATED_THRESHOLD = 10_000
const PREORDER_SALES_CHANNEL_NAME = "Pre-Order"

type VariantRow = {
  id: string
  title?: string | null
  product?: { title?: string | null } | null
  prices?: { id: string; amount: number | null; currency_code: string | null }[]
}

export default async function fixSourcingPrice100x({ container, args }: ExecArgs) {
  const apply =
    process.env.APPLY === "true" || (args ?? []).includes("--apply")
  const logger = container.resolve("logger")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Resolve the Pre-Order sales channel id by name (avoids a hardcoded id that
  // drifts across environments).
  const { data: channels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
    filters: { name: PREORDER_SALES_CHANNEL_NAME },
  })
  const channelId = (channels?.[0] as { id?: string } | undefined)?.id
  if (!channelId) {
    logger.error(
      `[fix-100x] Sales channel "${PREORDER_SALES_CHANNEL_NAME}" not found — aborting.`,
    )
    return
  }

  // Find products in that channel via the link table (proven pattern from
  // link-preorder-products-to-channel.ts — avoids over-strict nested filter
  // typing on the query graph).
  const { data: links } = await query.graph({
    entity: "product_sales_channel",
    fields: ["product_id", "sales_channel_id"],
  })
  const productIds = (links as { product_id: string; sales_channel_id: string }[])
    .filter((l) => l.sales_channel_id === channelId)
    .map((l) => l.product_id)
  if (productIds.length === 0) {
    logger.info("[fix-100x] no products linked to the Pre-Order channel. done.")
    return
  }

  // Pull every variant on those products with its MUR price rows.
  const { data: variants } = (await query.graph({
    entity: "product_variant",
    fields: [
      "id",
      "title",
      "product.title",
      "prices.id",
      "prices.amount",
      "prices.currency_code",
    ],
    filters: { product_id: productIds },
  })) as unknown as { data: VariantRow[] }

  const updates: {
    id: string
    prices: { amount: number; currency_code: string }[]
  }[] = []
  let scanned = 0
  let alreadyOk = 0

  for (const v of variants) {
    const mur = (v.prices ?? []).filter((p) => p.currency_code === "mur")
    if (mur.length === 0) continue
    scanned++

    const inflated = mur.filter(
      (p) => typeof p.amount === "number" && p.amount >= INFLATED_THRESHOLD,
    )
    if (inflated.length === 0) {
      alreadyOk++
      continue
    }

    const label = `${v.product?.title ?? "?"} / ${v.title ?? "?"}`
    const fixedPrices = mur.map((p) => {
      const amt = p.amount ?? 0
      const next = amt >= INFLATED_THRESHOLD ? Math.round(amt / 100) : amt
      if (amt !== next) {
        logger.info(`[fix-100x] ${label}: ${amt} -> ${next} mur`)
      }
      return { amount: next, currency_code: "mur" }
    })
    updates.push({ id: v.id, prices: fixedPrices })
  }

  logger.info(
    `[fix-100x] scanned ${scanned} MUR variants — ${updates.length} inflated, ${alreadyOk} already correct.`,
  )

  if (updates.length === 0) {
    logger.info("[fix-100x] nothing to fix. done.")
    return
  }

  if (!apply) {
    logger.info(
      "[fix-100x] DRY RUN — re-run with `-- --apply` to write these changes.",
    )
    return
  }

  await updateProductVariantsWorkflow(container).run({
    input: { product_variants: updates },
  })
  logger.info(`[fix-100x] applied ${updates.length} variant price fix(es). done.`)
}
