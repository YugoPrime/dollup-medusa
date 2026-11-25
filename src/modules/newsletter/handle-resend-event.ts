import type { ParsedResendEvent } from "./lib/resend-event"
import type { NewsletterList } from "./types"

export type NewEventRow = {
  svix_id: string
  campaign_id: string
  broadcast_id: string
  email_id: string
  type: string
  email: string | null
  link: string | null
  bounce_type: string | null
  occurred_at: Date
}

export type ResendHookDeps = {
  findCampaignByBroadcast(broadcastId: string): Promise<{ id: string; list: NewsletterList } | null>
  /** Inserts the row unless an event with the same svix_id exists. */
  recordEvent(row: NewEventRow): Promise<"created" | "duplicate">
  /** Medusa side: marks the email unsubscribed on one list, or on every list when list is null. */
  unsubscribe(list: NewsletterList | null, email: string): Promise<number>
  /** Resend side: sets the contact's unsubscribed flag so no broadcast reaches it again. */
  unsubscribeInResend(email: string): Promise<void>
  logger: { info?: (m: string) => void; warn?: (m: string) => void; error: (m: string) => void }
}

/**
 * Applies one verified Resend webhook event. Returns a short outcome for logs and tests.
 * Throws only when the database write fails, so the route answers 500 and Resend retries.
 */
export async function handleResendEvent(
  deps: ResendHookDeps,
  event: ParsedResendEvent,
  svixId: string
): Promise<string> {
  if (event.kind === "ignored") return `ignored: ${event.reason}`

  if (event.kind === "contact_unsubscribed") {
    // Someone used the unsubscribe link (or was unsubscribed in the Resend dashboard).
    const n = await deps.unsubscribe(null, event.email)
    return n > 0 ? "unsubscribed" : "already unsubscribed"
  }

  // Order and account emails carry no broadcast id: they are not newsletter events.
  if (!event.broadcastId) return "ignored: not a newsletter email"
  const campaign = await deps.findCampaignByBroadcast(event.broadcastId)
  if (!campaign) return "ignored: unknown broadcast"

  const outcome = await deps.recordEvent({
    svix_id: svixId,
    campaign_id: campaign.id,
    broadcast_id: event.broadcastId,
    email_id: event.emailId,
    type: event.type,
    email: event.email,
    link: event.link,
    bounce_type: event.bounceType,
    occurred_at: event.occurredAt,
  })
  if (outcome === "duplicate") return "duplicate"

  const hardBounce = event.type === "bounced" && (event.bounceType ?? "").toLowerCase() === "permanent"
  if ((hardBounce || event.type === "complained") && event.email) {
    await deps.unsubscribe(campaign.list, event.email)
    try {
      await deps.unsubscribeInResend(event.email)
    } catch (e) {
      // Resend already suppresses hard bounces and complaints; the Medusa row is what matters here.
      deps.logger.warn?.(
        `[hooks/resend] could not unsubscribe ${event.email} in Resend: ${e instanceof Error ? e.message : String(e)}`
      )
    }
    return `recorded ${event.type}, unsubscribed`
  }
  return `recorded ${event.type}`
}
