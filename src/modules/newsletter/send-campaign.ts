import { MedusaError } from "@medusajs/framework/utils"

import { assertSendable } from "./campaign-rules"
import { normalizeEmail } from "./lib/email"
import {
  buildCatalogueCards,
  type CatalogueProduct,
  type DropReason,
} from "./lib/catalogue"
import {
  BroadcastUnconfirmedError,
  requireSegment,
  type NewsletterConfig,
  type NewsletterResend,
} from "./newsletter-resend"
import { UNSUBSCRIBE_PLACEHOLDER, type renderCatalogueEmail } from "./render-catalogue"
import type NewsletterModuleService from "./service"
import type { CampaignDTO, NewsletterList } from "./types"

export type CampaignDeps = {
  // The two generated methods type JSON columns loosely, so they are narrowed to CampaignDTO here.
  service: Pick<
    NewsletterModuleService,
    | "listUnsynced"
    | "markSynced"
    | "markSyncError"
    | "markUnsubscribedByEmails"
    | "unsubscribedEmails"
    | "subscribedTotals"
  > & {
    retrieveNewsletterCampaign: (id: string) => Promise<CampaignDTO>
    updateNewsletterCampaigns: (
      patch: Partial<CampaignDTO> & { id: string }
    ) => Promise<CampaignDTO>
  }
  resend: NewsletterResend
  config: NewsletterConfig
  loadProducts: (ids: string[]) => Promise<CatalogueProduct[]>
  render: typeof renderCatalogueEmail
  withLock: <T>(key: string, fn: () => Promise<T>) => Promise<T>
}

type Dropped = Array<{ id: string; title: string | null; reason: DropReason }>

const invalid = (msg: string) => new MedusaError(MedusaError.Types.INVALID_DATA, msg)
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

export const UNCONFIRMED_SEND_MESSAGE =
  "Resend did not confirm the send — check the Resend dashboard before doing anything else."

export async function prepareCampaign(
  deps: CampaignDeps,
  c: CampaignDTO,
  unsubscribeUrl: string
): Promise<{ html: string; dropped: Dropped; cardCount: number }> {
  const products = await deps.loadProducts(c.product_ids)
  const { cards, dropped } = buildCatalogueCards(products, c.product_ids, {
    list: c.list,
    storefrontUrl: deps.config.storefrontUrl,
    campaignId: c.id,
  })
  const html = await deps.render({
    subject: c.subject,
    preheader: c.preheader,
    introText: c.intro_text,
    bannerUrl: c.banner_url,
    cards,
    storefrontUrl: deps.config.storefrontUrl,
    unsubscribeUrl,
  })
  return { html, dropped, cardCount: cards.length }
}

export async function previewCampaign(deps: CampaignDeps, id: string) {
  const c = await deps.service.retrieveNewsletterCampaign(id)
  const prepared = await prepareCampaign(deps, c, "#")
  const totals = await deps.service.subscribedTotals()
  const unsynced = await deps.service.listUnsynced(c.list)
  return { ...prepared, recipientEstimate: totals[c.list], unsyncedCount: unsynced.length }
}

export async function sendTestCampaign(deps: CampaignDeps, id: string, to: string): Promise<void> {
  const email = normalizeEmail(to)
  if (!email) throw invalid("enter a valid email address")
  const c = await deps.service.retrieveNewsletterCampaign(id)
  if (!c.subject.trim()) throw invalid("subject is required")
  const { html, cardCount } = await prepareCampaign(deps, c, "#")
  if (cardCount === 0) throw invalid("no products left to send")
  await deps.resend.sendTest({ to: email, subject: c.subject, html })
}

export async function syncList(
  deps: CampaignDeps,
  list: NewsletterList
): Promise<{
  unsubscribedPulled: number
  unsubscribedPushed: number
  pushFailed: number
  synced: number
  failed: number
}> {
  const segmentId = requireSegment(deps.config, list)

  // 1. Pull: whoever unsubscribed in Resend is unsubscribed in Medusa.
  const segment = await deps.resend.listSegmentEmails(segmentId)
  if (segment.unsubscribed.length > 0) {
    await deps.service.markUnsubscribedByEmails(list, segment.unsubscribed)
  }

  // 2. Push: whoever is unsubscribed in Medusa but still subscribed in the segment gets
  //    unsubscribed in Resend, so the broadcast cannot reach them.
  const stillSubscribed = new Set(segment.subscribed)
  let unsubscribedPushed = 0
  let pushFailed = 0
  // Sequential on purpose: Resend allows 10 requests per second.
  for (const email of await deps.service.unsubscribedEmails(list)) {
    if (!stillSubscribed.has(email)) continue
    try {
      await deps.resend.setUnsubscribed(email)
      unsubscribedPushed++
    } catch {
      pushFailed++
    }
  }

  // 3. Add subscribed rows that are not in Resend yet.
  let synced = 0
  let failed = 0
  for (const row of await deps.service.listUnsynced(list)) {
    const r = await deps.resend.ensureContact(row.email, segmentId, false)
    if (r.ok) {
      await deps.service.markSynced(row.id, r.contactId)
      synced++
    } else {
      await deps.service.markSyncError(row.id, r.error)
      failed++
    }
  }
  return {
    unsubscribedPulled: segment.unsubscribed.length,
    unsubscribedPushed,
    pushFailed,
    synced,
    failed,
  }
}

export async function sendCampaign(
  deps: CampaignDeps,
  id: string,
  sentBy: string | null,
  /** The list the admin previewed; a mismatch means the campaign changed under them. */
  expectedList?: NewsletterList
): Promise<CampaignDTO> {
  const { service, resend } = deps

  // Claim the campaign under a lock so a double press creates one broadcast.
  const { c, segmentId } = await deps.withLock("newsletter-send:" + id, async () => {
    const current = await service.retrieveNewsletterCampaign(id)
    assertSendable(current)
    if (expectedList && current.list !== expectedList) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The campaign's list changed since the preview. Preview again."
      )
    }
    const segment = requireSegment(deps.config, current.list)
    await service.updateNewsletterCampaigns({ id, status: "sending", error: null })
    return { c: current, segmentId: segment }
  })

  let broadcastId: string | null = null
  let revertedToDraft = false
  try {
    const sync = await syncList(deps, c.list)
    if (sync.pushFailed > 0) {
      // Not a draft-revert guard: the catch below marks the campaign failed (retryable).
      const who = sync.pushFailed === 1 ? "1 person" : `${sync.pushFailed} people`
      throw invalid(`Couldn't unsubscribe ${who} in Resend; not sending. Try again.`)
    }

    const recipients = (await service.subscribedTotals())[c.list] - sync.failed
    if (recipients <= 0) {
      await service.updateNewsletterCampaigns({ id, status: "draft" })
      revertedToDraft = true
      throw invalid("list has no subscribers")
    }

    const { html, cardCount } = await prepareCampaign(deps, c, UNSUBSCRIBE_PLACEHOLDER)
    if (cardCount === 0) {
      await service.updateNewsletterCampaigns({ id, status: "draft" })
      revertedToDraft = true
      throw invalid("no products left to send")
    }

    const created = await resend.createAndSendBroadcast({
      segmentId,
      subject: c.subject,
      html,
      name: "Doll Up " + c.id,
      previewText: c.preheader,
    })
    broadcastId = created.id
    await service.updateNewsletterCampaigns({ id, resend_broadcast_id: broadcastId })

    return await service.updateNewsletterCampaigns({
      id,
      status: "sent",
      sent_at: new Date(),
      sent_by: sentBy,
      recipient_count: recipients,
    })
  } catch (err) {
    if (revertedToDraft) throw err
    const message = messageOf(err)
    if (broadcastId === null && err instanceof BroadcastUnconfirmedError) {
      // Resend may have sent it: never mark failed (that would allow a second send).
      // Status stays `sending`, so assertSendable rejects any retry.
      try {
        await service.updateNewsletterCampaigns({ id, error: UNCONFIRMED_SEND_MESSAGE })
      } catch {
        // best effort
      }
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, UNCONFIRMED_SEND_MESSAGE)
    }
    if (broadcastId === null) {
      // Resend never accepted the broadcast (or we stopped before asking): retryable.
      try {
        await service.updateNewsletterCampaigns({ id, status: "failed", error: message })
      } catch {
        // keep the original error
      }
      throw err
    }
    // The email WAS sent: never mark failed, never allow a retry.
    try {
      await service.updateNewsletterCampaigns({
        id,
        resend_broadcast_id: broadcastId,
        error: "Sent, but saving the result failed: " + message,
      })
    } catch {
      // best effort
    }
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `The email was sent (Resend broadcast ${broadcastId}) but saving the result failed. Check Resend; do not resend.`
    )
  }
}
