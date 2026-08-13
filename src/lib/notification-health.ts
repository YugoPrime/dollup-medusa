/**
 * Pure summarizer + alert builder behind the `check-notification-failures` job.
 *
 * Background — the 2026-08-01 → 2026-08-13 blackout:
 * a boot with an incomplete RESEND_* env made Medusa's provider loader disable
 * the `resend` row in `notification_provider`. Every notification after that was
 * created, immediately stamped `status = failure`, and dropped. 179 notifications
 * and 31 real customer emails were lost over 12 days with no log line, no bounce
 * and no alert — it surfaced only when a customer said he never got his
 * delivery notice. This module exists so that never repeats.
 *
 * Two distinct broken states are detected, because status alone lies:
 *
 *   failure  — Medusa never handed it to a provider (the blackout signature).
 *
 *   phantom  — status says `success` but `external_id` is null on a genuinely
 *              sendable address. ResendNotificationProviderService.send()
 *              returns `{}` when Resend rejects the mail or answers without an
 *              id, and the notification module reads that as SUCCESS. Nothing
 *              was ever sent. Without this check a revoked key, an unverified
 *              domain or a suppressed recipient stays completely invisible.
 *
 * A `success` with no external_id on a NON-sendable placeholder address
 * (`dm-<phone>@dollupboutique.local`) is the provider deliberately skipping —
 * counted as `skipped`, never alerted on.
 */
import { isSendableEmail } from "./sendable-email"

export type NotificationRow = {
  to: string
  template?: string | null
  status?: string | null
  external_id?: string | null
}

export type NotificationHealth = {
  total: number
  /** success + a Resend message id — genuinely accepted for delivery. */
  delivered: number
  /** success on a placeholder address — skipped on purpose. */
  skipped: number
  /** success but nothing reached Resend. Silent data loss. */
  phantom: number
  /** never handed to a provider at all. */
  failed: number
  /** created but the process died mid-send. */
  pending: number
  /** failed + phantom, keyed by template. */
  brokenByTemplate: Record<string, number>
  /** distinct real customer addresses that lost an email. */
  affectedRecipients: string[]
}

export type HealthVerdict = "ok" | "degraded" | "outage"

export function summarizeNotificationHealth(
  rows: NotificationRow[],
): NotificationHealth {
  const health: NotificationHealth = {
    total: rows.length,
    delivered: 0,
    skipped: 0,
    phantom: 0,
    failed: 0,
    pending: 0,
    brokenByTemplate: {},
    affectedRecipients: [],
  }

  const affected = new Set<string>()

  for (const row of rows) {
    const status = (row.status ?? "").toLowerCase()
    const sendable = isSendableEmail(row.to)
    const hasExternalId = Boolean(row.external_id)

    let broken = false

    if (status === "failure") {
      health.failed++
      broken = true
    } else if (status === "pending") {
      health.pending++
    } else if (status === "success") {
      if (hasExternalId) {
        health.delivered++
      } else if (sendable) {
        health.phantom++
        broken = true
      } else {
        health.skipped++
      }
    }

    if (broken) {
      const template = row.template ?? "unknown"
      health.brokenByTemplate[template] =
        (health.brokenByTemplate[template] ?? 0) + 1
      // Only real addresses represent a customer who actually lost an email.
      if (sendable) affected.add(row.to.toLowerCase())
    }
  }

  health.affectedRecipients = [...affected].sort()
  return health
}

export function classifyNotificationHealth(
  health: NotificationHealth,
): HealthVerdict {
  const broken = health.failed + health.phantom
  if (broken === 0) return "ok"
  // Nothing got through at all — the provider is almost certainly unregistered,
  // which is the shape the Aug 2026 blackout took.
  if (health.delivered === 0) return "outage"
  return "degraded"
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/**
 * Returns the Telegram HTML body, or null when there is nothing worth saying.
 * Kept separate from the job so severity wording is unit-testable.
 */
export function buildNotificationHealthAlert(
  health: NotificationHealth,
  verdict: HealthVerdict,
  windowHours: number,
): string | null {
  if (verdict === "ok") return null

  const broken = health.failed + health.phantom
  const lines: string[] = []

  if (verdict === "outage") {
    lines.push("🚨 <b>CUSTOMER EMAIL IS DOWN</b>")
    lines.push("")
    lines.push(
      `<b>${broken}</b> notification${broken === 1 ? "" : "s"} in the last ${windowHours}h and <b>not one</b> was delivered.`,
    )
  } else {
    lines.push("⚠️ <b>Customer emails are failing</b>")
    lines.push("")
    lines.push(
      `<b>${broken}</b> of <b>${health.total}</b> notification${health.total === 1 ? "" : "s"} in the last ${windowHours}h did not reach Resend.`,
    )
  }

  lines.push("")
  if (health.failed > 0) {
    lines.push(`• <b>${health.failed}</b> failed — no provider took them`)
  }
  if (health.phantom > 0) {
    lines.push(
      `• <b>${health.phantom}</b> marked success but never reached Resend`,
    )
  }
  if (health.pending > 0) {
    lines.push(`• <b>${health.pending}</b> stuck pending (died mid-send)`)
  }
  if (health.delivered > 0) {
    lines.push(`• ${health.delivered} delivered OK`)
  }

  const templates = Object.entries(health.brokenByTemplate).sort(
    (a, b) => b[1] - a[1],
  )
  if (templates.length > 0) {
    lines.push("")
    lines.push(
      "Lost: " +
        templates.map(([t, n]) => `${escapeHtml(t)} ×${n}`).join(", "),
    )
  }

  const affected = health.affectedRecipients
  if (affected.length > 0) {
    lines.push("")
    lines.push(
      `<b>${affected.length}</b> real customer${affected.length === 1 ? "" : "s"} affected:`,
    )
    for (const addr of affected.slice(0, 5)) {
      lines.push(`  ${escapeHtml(addr)}`)
    }
    if (affected.length > 5) {
      lines.push(`  …and ${affected.length - 5} more`)
    }
  }

  if (verdict === "outage") {
    lines.push("")
    lines.push("<b>Most likely: the resend provider is disabled.</b>")
    lines.push(
      "A boot with an incomplete <code>RESEND_*</code> env disables it permanently — fixing the env in Coolify alone does nothing.",
    )
    lines.push("")
    lines.push("<b>Fix: restart the dollup-medusa container.</b>")
    lines.push(
      "The provider sync re-enables it on boot. Verify with <code>select id, is_enabled from notification_provider</code> → resend must be true.",
    )
  }

  return lines.join("\n")
}
