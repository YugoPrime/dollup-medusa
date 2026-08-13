/**
 * Daily watchdog over the notification table. Runs 08:00 Mauritius (UTC+4)
 * = 04:00 UTC.
 *
 * Reads every notification created in the last 24h and alerts on Telegram when
 * any of them failed to reach Resend. Silent when everything is healthy, so a
 * message from this job always means something is actually broken.
 *
 * Exists because customer email was dead from 2026-08-01 to 2026-08-13 —
 * 179 notifications and 31 real customer emails lost — and the only trace was a
 * status column nobody reads. See src/lib/notification-health.ts for the two
 * broken states it detects and why `status` alone is not trustworthy.
 *
 * Deliberately quiet when the window is empty: zero notifications means zero
 * orders, which is a business signal, not an email fault. The blackout produced
 * failures every single day, so a 24h window always catches it.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import {
  buildNotificationHealthAlert,
  classifyNotificationHealth,
  summarizeNotificationHealth,
  type NotificationRow,
} from "../lib/notification-health"
import { sendTelegram } from "../lib/telegram"

const WINDOW_HOURS = 24

// Far above the ~30/day this store produces. Bounded so a runaway retry loop
// can't pull the whole table into memory.
const MAX_ROWS = 5000

export default async function checkNotificationFailures(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000)

  let rows: NotificationRow[]
  try {
    const notificationService = container.resolve(Modules.NOTIFICATION) as {
      listNotifications: (
        filters: Record<string, unknown>,
        config?: Record<string, unknown>,
      ) => Promise<NotificationRow[]>
    }
    rows = await notificationService.listNotifications(
      { created_at: { $gte: since } },
      {
        select: ["id", "to", "template", "status", "external_id", "created_at"],
        order: { created_at: "DESC" },
        take: MAX_ROWS,
      },
    )
  } catch (err) {
    // A watchdog that dies quietly is worse than no watchdog.
    logger.error(
      `[notification-health] could not read notifications: ${(err as Error).message}`,
    )
    await sendTelegram(
      [
        "⚠️ <b>Email watchdog could not run</b>",
        "",
        "Failed to read the notification table, so customer-email health is currently UNKNOWN.",
        "",
        "Check the dollup-medusa logs.",
      ].join("\n"),
    )
    return
  }

  const health = summarizeNotificationHealth(rows)
  const verdict = classifyNotificationHealth(health)

  if (verdict === "ok") {
    logger.info(
      `[notification-health] healthy — ${health.delivered} delivered, ${health.skipped} skipped placeholders, ${health.total} total in ${WINDOW_HOURS}h`,
    )
    return
  }

  logger.error(
    `[notification-health] ${verdict.toUpperCase()} — ${health.failed} failed, ${health.phantom} phantom, ${health.delivered} delivered, ${health.affectedRecipients.length} customers affected`,
  )

  const message = buildNotificationHealthAlert(health, verdict, WINDOW_HOURS)
  if (!message) return

  const sent = await sendTelegram(message)
  if (!sent.ok && !("skipped" in sent)) {
    logger.error(
      `[notification-health] Telegram alert failed to send: ${sent.message}`,
    )
  }
}

export const config = {
  name: "check-notification-failures",
  // 08:00 Mauritius (UTC+4) = 04:00 UTC. Before the day's orders start landing,
  // so a broken pipeline is caught before it costs another day of emails.
  schedule: "0 4 * * *",
}
