/**
 * Corrects pre-order shipping options that were entered in cents (100x too
 * high) to whole-rupee MUR amounts matching apex. One-shot; safe to re-run
 * (idempotent — sets absolute values on every existing MUR price row).
 *
 * Only touches the 3 Pre-Order options (stock location "Pre-Order Fulfillment",
 * sloc_01KSMPP7411KT7AXW3NR0DV3FN). Apex options live under a different stock
 * location and are NOT affected. Pickup (Pre-Order) is already 0 — untouched.
 *
 * Run: yarn medusa exec ./src/scripts/fix-preorder-shipping-prices.ts
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

const FIXES: { id: string; name: string; amount: number }[] = [
  { id: "so_01KSMQMT8FJVNVK640TGJ8NYSB", name: "Home delivery (Pre-Order)", amount: 150 },
  { id: "so_01KSMQMT8F1RV9BRHB05PTVFSG", name: "Postage (Pre-Order)", amount: 70 },
  { id: "so_01KSMQMT8GARBFM0M9BVK4ZSY0", name: "Rodrigues Postage (Pre-Order)", amount: 100 },
]

export default async function fixPreorderShippingPrices({ container }: ExecArgs) {
  const logger = container.resolve("logger")
  const fulfillment = container.resolve(Modules.FULFILLMENT)

  for (const fix of FIXES) {
    const opt = (await fulfillment.retrieveShippingOption(fix.id, {
      relations: ["prices"],
    })) as unknown as {
      id: string
      prices?: { id: string; currency_code?: string | null; amount?: number | null }[]
    }
    const murPrices = (opt.prices ?? []).filter((p) => p.currency_code === "mur")
    if (murPrices.length === 0) {
      logger.warn(`[fix-shipping] ${fix.name}: no MUR price found, skipping`)
      continue
    }
    await fulfillment.updateShippingOptions(fix.id, {
      prices: murPrices.map((p) => ({ id: p.id, amount: fix.amount })),
    })
    logger.info(
      `[fix-shipping] ${fix.name} → MUR ${fix.amount} (${murPrices.length} price row(s))`,
    )
  }
  logger.info("[fix-shipping] done")
}
