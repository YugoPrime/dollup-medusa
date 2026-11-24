/**
 * Nightly stock value snapshot for the admin Restock report's daily chart.
 * Runs 23:55 Mauritius (UTC+4) = 19:55 UTC, so the row is the day's closing
 * stock. History can't be rebuilt afterwards: a missed night is a gap.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { takeStockSnapshot } from "../modules/stock-snapshots/take-snapshot"

export default async function stockValueSnapshot(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const row = await takeStockSnapshot(container)
    logger.info(
      `[stock-snapshot] ${row.day}: ${row.units} pcs, Rs ${row.cost_value_mur} at cost, Rs ${row.retail_value_mur} at shop price, ${row.uncosted_units} pcs with no cost`,
    )
  } catch (e) {
    logger.error(
      `[stock-snapshot] failed: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

export const config = {
  name: "stock-value-snapshot",
  // 23:55 Mauritius (UTC+4) = 19:55 UTC.
  schedule: "55 19 * * *",
}
