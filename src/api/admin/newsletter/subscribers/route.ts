import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { NEWSLETTER_MODULE } from "../../../../modules/newsletter"
import { normalizeEmail } from "../../../../modules/newsletter/lib/email"
import {
  createNewsletterResend,
  getNewsletterConfig,
  requireSegment,
} from "../../../../modules/newsletter/newsletter-resend"
import { parseList, sendError } from "../../../../modules/newsletter/route-deps"
import type NewsletterModuleService from "../../../../modules/newsletter/service"

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const service = req.scope.resolve<NewsletterModuleService>(NEWSLETTER_MODULE)
    const query = (req.query ?? {}) as Record<string, unknown>
    const list = parseList(typeof query.list === "string" && query.list ? query.list : "main")
    const status =
      query.status === "subscribed" || query.status === "unsubscribed" ? query.status : undefined
    const q = typeof query.q === "string" && query.q.trim() ? query.q.trim() : undefined
    const limitRaw = Number(query.limit)
    const offsetRaw = Number(query.offset)
    const limit = clamp(
      query.limit !== undefined && Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 50,
      1,
      200,
    )
    const offset = Math.max(0, Number.isFinite(offsetRaw) ? Math.trunc(offsetRaw) : 0)

    const { subscribers, count } = await service.listSubscribersPage({
      list,
      status,
      q,
      limit,
      offset,
    })
    const totals = await service.subscribedTotals()
    const unsynced = (await service.listUnsynced(list)).length
    res.json({ subscribers, count, totals, unsynced })
  } catch (err) {
    sendError(res, err, req.scope.resolve("logger"))
  }
}

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const logger = req.scope.resolve("logger") as any
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const list = parseList(body.list)
    const email = normalizeEmail(body.email)
    if (!email) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Invalid email address")
    }
    const service = req.scope.resolve<NewsletterModuleService>(NEWSLETTER_MODULE)
    // Medusa first: the subscriber is saved even if Resend is down or unconfigured.
    const { subscriber, outcome } = await service.addSubscriber({ email, list, source: "admin" })

    let syncError: string | null = null
    try {
      const config = getNewsletterConfig()
      const segmentId = requireSegment(config, list)
      const resend = createNewsletterResend(config)
      if (outcome === "resubscribed") {
        await resend.resubscribe(email, segmentId)
        await service.markSynced(subscriber.id, subscriber.resend_contact_id ?? null)
      } else {
        const r = await resend.ensureContact(email, segmentId, false)
        if (r.ok) await service.markSynced(subscriber.id, r.contactId)
        else syncError = r.error
      }
    } catch (e) {
      syncError = e instanceof Error ? e.message : String(e)
    }
    if (syncError) {
      try {
        await service.markSyncError(subscriber.id, syncError)
      } catch (e) {
        logger.error(`newsletter: could not record sync error: ${(e as Error).message}`)
      }
      logger.error(`newsletter: Resend sync failed for a subscriber: ${syncError}`)
    }
    res.json({ subscriber, outcome, sync_error: syncError })
  } catch (err) {
    sendError(res, err, logger)
  }
}
