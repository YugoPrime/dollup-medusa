/**
 * Corrects any flat shipping option whose MUR price is 100x too high (entered
 * in minor units / cents when this DB stores MUR as whole rupees).
 *
 * Background: the apex `setup-shipping.ts` seeded "Livraison express" at 15000
 * (meant to be Rs 150), and 3 pre-order options were likewise entered in cents
 * (those were already fixed by fix-preorder-shipping-prices.ts). This script is
 * the general backfill: it scans every shipping option, finds MUR price rows at
 * or above THRESHOLD, and divides them by 100.
 *
 * Idempotent: only prices >= THRESHOLD are touched, so re-running after a fix
 * leaves already-correct (sub-threshold) prices alone. A free option (0) is
 * never matched.
 *
 * Dry-run (default): yarn medusa exec ./src/scripts/fix-shipping-price-100x.ts
 * Apply:             APPLY=true yarn medusa exec ./src/scripts/fix-shipping-price-100x.ts
 *
 * (Apply gates on the APPLY env var — `medusa exec` does not forward CLI flags
 * after `--`. As of this writing the live MU shipping options are already at
 * whole-rupee values, so this script is a no-op safety net.)
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"

// No real MU shipping fee reaches Rs 10,000. Anything at/above this is a 100x
// artifact (Rs 150 -> 15000, Rs 70 -> 7000 is below; tune if a real fee ever
// exceeds this — current real fees are 0/70/100/150).
const INFLATED_THRESHOLD = 10_000

type OptRow = {
  id: string
  name?: string | null
  prices?: { id: string; amount: number | null; currency_code: string | null }[]
}

export default async function fixShippingPrice100x({ container, args }: ExecArgs) {
  const apply =
    process.env.APPLY === "true" || (args ?? []).includes("--apply")
  const logger = container.resolve("logger")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // The fulfillment module's listShippingOptions does NOT expose `prices` as a
  // relation; the price set is linked via the pricing module. Read it through
  // the query graph, which resolves the cross-module link.
  const { data: options } = (await query.graph({
    entity: "shipping_option",
    fields: [
      "id",
      "name",
      "prices.id",
      "prices.amount",
      "prices.currency_code",
    ],
  })) as unknown as { data: OptRow[] }

  let fixedCount = 0
  for (const opt of options) {
    const mur = (opt.prices ?? []).filter((p) => p.currency_code === "mur")
    const inflated = mur.filter(
      (p) => typeof p.amount === "number" && p.amount >= INFLATED_THRESHOLD,
    )
    if (inflated.length === 0) continue

    const label = opt.name ?? opt.id
    const fixedPrices = mur.map((p) => {
      const amt = p.amount ?? 0
      const next = amt >= INFLATED_THRESHOLD ? Math.round(amt / 100) : amt
      if (amt !== next) {
        logger.info(`[fix-shipping-100x] ${label}: ${amt} -> ${next} mur`)
      }
      return { id: p.id, amount: next, currency_code: "mur" }
    })

    fixedCount++
    if (apply) {
      await updateShippingOptionsWorkflow(container).run({
        input: [{ id: opt.id, prices: fixedPrices }],
      })
    }
  }

  if (fixedCount === 0) {
    logger.info("[fix-shipping-100x] no inflated MUR shipping prices found. done.")
    return
  }
  logger.info(
    apply
      ? `[fix-shipping-100x] applied fixes to ${fixedCount} option(s). done.`
      : `[fix-shipping-100x] DRY RUN — ${fixedCount} option(s) would change. Re-run with \`-- --apply\`.`,
  )
}
