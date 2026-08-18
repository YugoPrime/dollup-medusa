/**
 * Daily watchdog over customer email. Runs 08:00 Mauritius (UTC+4) = 04:00 UTC.
 *
 * Two checks, one alert:
 *
 *   1. Canary — sends one real email to an internal address and asserts Resend
 *      handed back a message id. Proves the pipe end-to-end even on a day with
 *      zero orders, and catches a revoked key or unverified domain that the
 *      row sweep could never see.
 *
 *   2. Sweep — reads every notification from the last 24h and looks for rows
 *      that never reached Resend.
 *
 * Silent when healthy, so a message from this job always means something is
 * genuinely broken.
 *
 * Exists because customer email was dead from 2026-08-01 to 2026-08-13 —
 * 179 notifications and 31 real customer emails lost — and the only trace was a
 * status column nobody reads. See src/lib/notification-health.ts.
 */
import type {
  INotificationModuleService,
  MedusaContainer,
} from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import {
  buildEmailHealthAlert,
  canaryIsBroken,
  classifyEmailHealth,
  summarizeNotificationHealth,
  type CanaryOutcome,
  type NotificationRow,
} from "../lib/notification-health"
import { EmailTemplate } from "../modules/notification-resend/service"
import { sendTelegram } from "../lib/telegram"

const WINDOW_HOURS = 24

// Far above the ~30/day this store produces. Bounded so a runaway retry loop
// can't pull the whole table into memory.
const MAX_ROWS = 5000

// Alert inbox, never a personal address. Set EMAIL_CANARY_TO="" to disable the
// canary and fall back to the row sweep alone.
const CANARY_TO = process.env.EMAIL_CANARY_TO ?? "hello@influxe.agency"

const STOREFRONT_URL =
  process.env.STOREFRONT_URL ?? "https://dollupboutique.com"

/**
 * Sends one synthetic email and reports whether Resend actually took it.
 * Reuses the `welcome` template with a subject override rather than adding a
 * canary-only template — the provider honours `data.subject`, so the message
 * self-labels in the inbox.
 */
async function runCanary(container: MedusaContainer): Promise<CanaryOutcome> {
  if (!CANARY_TO.trim()) return { status: "skipped" }

  const notificationService = container.resolve<INotificationModuleService>(
    Modules.NOTIFICATION,
  )

  try {
    const result = await notificationService.createNotifications({
      to: CANARY_TO,
      channel: "email",
      template: EmailTemplate.WELCOME,
      data: {
        subject: "[canary] Doll Up email pipeline OK",
        storefrontUrl: STOREFRONT_URL,
        customerFirstName: "Email pipeline canary",
        welcomeBonusPoints: 0,
      },
    })
    // A resolved call is not proof: the provider returns {} when Resend
    // rejects the mail, and the module records that as success.
    if (!result?.external_id) return { status: "not_sent" }
    return { status: "ok", externalId: result.external_id }
  } catch (err) {
    return { status: "threw", message: (err as Error).message }
  }
}

export default async function checkNotificationFailures(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const canary = await runCanary(container)
  if (canary.status === "ok") {
    logger.info(`[email-health] canary delivered (${canary.externalId})`)
  } else if (canaryIsBroken(canary)) {
    logger.error(
      `[email-health] canary FAILED: ${canary.status === "threw" ? canary.message : "no message id returned"}`,
    )
  }

  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000)

  let rows: NotificationRow[] = []
  let sweepFailed = false
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
    sweepFailed = true
    logger.error(
      `[email-health] could not read notifications: ${(err as Error).message}`,
    )
  }

  const health = summarizeNotificationHealth(rows)
  const verdict = classifyEmailHealth(health, canary)

  if (verdict === "ok" && !sweepFailed) {
    logger.info(
      `[email-health] healthy — canary ${canary.status}, ${health.delivered} delivered, ${health.skipped} skipped placeholders, ${health.total} total in ${WINDOW_HOURS}h`,
    )
    return
  }

  if (sweepFailed && verdict === "ok") {
    await sendTelegram(
      [
        "⚠️ <b>Email watchdog could not fully run</b>",
        "",
        "The live test send worked, but the notification table could not be read — so the last 24h are UNVERIFIED.",
        "",
        "Check the dollup-medusa logs.",
      ].join("\n"),
    )
    return
  }

  logger.error(
    `[email-health] ${verdict.toUpperCase()} — canary ${canary.status}, ${health.failed} failed, ${health.phantom} phantom, ${health.delivered} delivered, ${health.affectedRecipients.length} customers affected`,
  )

  const message = buildEmailHealthAlert({
    health,
    verdict,
    windowHours: WINDOW_HOURS,
    canary,
  })
  if (!message) return

  const sent = await sendTelegram(message)
  if (!sent.ok && !("skipped" in sent)) {
    logger.error(
      `[email-health] Telegram alert failed to send: ${sent.message}`,
    )
  }
}

export const config = {
  name: "check-notification-failures",
  // 08:00 Mauritius (UTC+4) = 04:00 UTC. Before the day's orders start landing,
  // so a broken pipeline is caught before it costs another day of emails.
  schedule: "0 4 * * *",
}
