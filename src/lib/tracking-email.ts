// When a customer gets the "here's your tracking number" email (Rahvi,
// 26 Nov 2026). The shipped email for a postage order without a number
// promises "your tracking number will be sent in a follow-up email
// shortly"; this is that follow-up, sent when staff save the number later
// in the dollup-admin order drawer.
import { isSendableEmail } from "./sendable-email"

/** Emitted by POST /admin/orders/:id/notify-tracking when the email should go. */
export const ORDER_TRACKING_EVENT = "dm.order.tracking_added"

/** "dp 207137471 mu" → "DP207137471MU"; blank → null. */
export function normalizeTrackingNumber(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const cleaned = raw.replace(/\s+/g, "").toUpperCase()
  return cleaned || null
}

/**
 * dollup-admin gives DM orders a placeholder address on
 * `@dollupboutique.local` (85 of 87 DM postage orders on 26 Nov 2026), so
 * in practice only website orders reach a real inbox. Our own domain is
 * skipped too: no customer has one, and orders.dollupboutique.com (seen on
 * one DM order) does not exist.
 */
export function isRealCustomerEmail(email: unknown): boolean {
  if (typeof email !== "string" || !isSendableEmail(email)) return false
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase()
  return !/(^|\.)dollupboutique\.com$/.test(domain)
}

/** Postage, Express Postage, Rodrigues Postage. */
export function isPostageDelivery(deliveryMethod: unknown): boolean {
  return typeof deliveryMethod === "string" && /post/i.test(deliveryMethod)
}

export type TrackingEmailDecision =
  | { send: true; number: string }
  | {
      send: false
      reason:
        | "no_number"
        | "not_postage"
        | "no_email"
        | "not_shipped"
        | "already_sent"
    }

/**
 * Send once per number, only for a postage order with a real email whose
 * shipped email already went out. Before that, the shipped email carries
 * the number itself (notify-shipped then stamps tracking_emailed).
 * A corrected number (typo fix) is a new number, so it is sent again.
 */
export function trackingEmailDecision(order: {
  email?: string | null
  metadata?: Record<string, unknown> | null
}): TrackingEmailDecision {
  const meta = order.metadata ?? {}
  const number = normalizeTrackingNumber(meta.tracking_number)
  if (!number) return { send: false, reason: "no_number" }
  if (!isPostageDelivery(meta.delivery_method)) {
    return { send: false, reason: "not_postage" }
  }
  if (!isRealCustomerEmail(order.email)) return { send: false, reason: "no_email" }
  if (typeof meta.shipped_at !== "string" || !meta.shipped_at) {
    return { send: false, reason: "not_shipped" }
  }
  if (normalizeTrackingNumber(meta.tracking_emailed) === number) {
    return { send: false, reason: "already_sent" }
  }
  return { send: true, number }
}
