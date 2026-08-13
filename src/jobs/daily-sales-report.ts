/**
 * Daily sales recap on Telegram. Runs 08:00 Mauritius (UTC+4) = 04:00 UTC and
 * reports the **previous** Mauritius day, so the numbers are final rather than
 * a moving partial total.
 *
 * Revenue counts orders placed that day, cancellations excluded, exchange
 * credit deducted — see src/lib/daily-sales-report.ts for why, and keep it in
 * sync with dollup-admin/src/lib/dashboard-analytics.ts so the recap and the
 * dashboard never disagree.
 *
 * Unlike the email watchdog this job always speaks, including on a zero-order
 * day — silence would be indistinguishable from a broken job.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import {
  buildDailySalesMessage,
  buildDailySalesReport,
  muDay,
  shiftDay,
  type OrderLike,
} from "../lib/daily-sales-report"
import { sendTelegram } from "../lib/telegram"

// 8 Mauritius days: the reported day, the day before, and the same day last
// week, plus a day of slack at each edge so UTC/MU boundaries can't clip a
// bucket.
const LOOKBACK_DAYS = 9

const MAX_ORDERS = 5000

export default async function dailySalesReport(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  // Yesterday in Mauritius terms.
  const day = shiftDay(muDay(new Date()), -1)
  const since = new Date(
    new Date(`${shiftDay(day, -LOOKBACK_DAYS)}T00:00:00.000Z`).getTime() -
      4 * 60 * 60 * 1000,
  )

  let orders: OrderLike[]
  try {
    const orderService = container.resolve(Modules.ORDER) as {
      listOrders: (
        filters: Record<string, unknown>,
        config?: Record<string, unknown>,
      ) => Promise<OrderLike[]>
    }
    orders = await orderService.listOrders(
      { created_at: { $gte: since } },
      {
        // `total` must be in the select or the order module skips its totals
        // calculator entirely and every order comes back as 0.
        select: ["id", "created_at", "status", "total", "metadata"],
        order: { created_at: "DESC" },
        take: MAX_ORDERS,
      },
    )
  } catch (err) {
    logger.error(
      `[sales-report] could not read orders: ${(err as Error).message}`,
    )
    await sendTelegram(
      [
        "⚠️ <b>Daily sales report failed</b>",
        "",
        `Could not read orders for ${day}.`,
        "",
        "Check the dollup-medusa logs.",
      ].join("\n"),
    )
    return
  }

  const report = buildDailySalesReport(orders, day)
  const message = buildDailySalesMessage(report)

  logger.info(
    `[sales-report] ${day}: ${report.today.orders} orders, ${report.today.revenueMur} MUR`,
  )

  const sent = await sendTelegram(message)
  if (!sent.ok && !("skipped" in sent)) {
    logger.error(`[sales-report] Telegram send failed: ${sent.message}`)
  }
}

export const config = {
  name: "daily-sales-report",
  // 08:00 Mauritius (UTC+4) = 04:00 UTC, reporting the day that just closed.
  schedule: "0 4 * * *",
}
