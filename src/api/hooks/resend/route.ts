import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { handleResendEvent } from "../../../modules/newsletter/handle-resend-event"
import { verifySvixSignature } from "../../../modules/newsletter/lib/svix"
import { parseResendEvent } from "../../../modules/newsletter/lib/resend-event"
import {
  createNewsletterResend,
  getNewsletterConfig,
} from "../../../modules/newsletter/newsletter-resend"
import { NEWSLETTER_LISTS, type NewsletterList } from "../../../modules/newsletter/types"
import { NEWSLETTER_MODULE } from "../../../modules/newsletter"
import type NewsletterModuleService from "../../../modules/newsletter/service"

const header = (req: MedusaRequest, name: string) => {
  const v = req.headers[name]
  return Array.isArray(v) ? v[0] : v
}

// Resend webhook (newsletter results + unsubscribe sync). The body arrives raw (see middlewares.ts)
// because the Svix signature covers the exact bytes Resend sent.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger = req.scope.resolve("logger") as {
    info: (m: string) => void
    warn: (m: string) => void
    error: (m: string) => void
  }
  const secret = process.env.RESEND_WEBHOOK_SECRET || ""
  if (!secret) {
    // 503 makes Resend retry, so events wait for the env var instead of being lost.
    res.status(503).send("webhook not configured")
    return
  }

  const raw = Buffer.isBuffer(req.body) ? (req.body as Buffer).toString("utf8") : ""
  const svixId = header(req, "svix-id")
  const ok = verifySvixSignature({
    payload: raw,
    id: svixId,
    timestamp: header(req, "svix-timestamp"),
    signature: header(req, "svix-signature"),
    secret,
  })
  if (!ok || !svixId) {
    res.status(401).send("bad signature")
    return
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    res.status(400).send("invalid json")
    return
  }

  const service = req.scope.resolve<NewsletterModuleService>(NEWSLETTER_MODULE)
  try {
    const outcome = await handleResendEvent(
      {
        findCampaignByBroadcast: (id) => service.findCampaignByBroadcast(id),
        recordEvent: (row) => service.recordEvent(row),
        unsubscribe: async (list: NewsletterList | null, email: string, before: Date) => {
          let n = 0
          for (const l of list ? [list] : NEWSLETTER_LISTS) {
            n += await service.markUnsubscribedByEmails(l, [email], before)
          }
          return n
        },
        unsubscribeInResend: (email) =>
          createNewsletterResend(getNewsletterConfig()).setUnsubscribed(email),
        logger,
      },
      parseResendEvent(body),
      svixId
    )
    if (outcome.includes("unsubscribed")) logger.info(`[hooks/resend] ${svixId}: ${outcome}`)
    res.status(200).send("ok")
  } catch (e) {
    logger.error(`[hooks/resend] ${svixId} failed: ${e instanceof Error ? e.message : String(e)}`)
    res.status(500).send("failed") // Resend retries
  }
}
