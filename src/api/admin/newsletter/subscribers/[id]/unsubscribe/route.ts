import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { NEWSLETTER_MODULE } from "../../../../../../modules/newsletter"
import {
  createNewsletterResend,
  getNewsletterConfig,
} from "../../../../../../modules/newsletter/newsletter-resend"
import { sendError } from "../../../../../../modules/newsletter/route-deps"
import type NewsletterModuleService from "../../../../../../modules/newsletter/service"

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const logger = req.scope.resolve("logger") as any
  try {
    const service = req.scope.resolve<NewsletterModuleService>(NEWSLETTER_MODULE)
    const subscriber = await service.markUnsubscribed(req.params.id)

    let syncError: string | null = null
    try {
      await createNewsletterResend(getNewsletterConfig()).setUnsubscribed(subscriber.email)
    } catch (e) {
      syncError = e instanceof Error ? e.message : String(e)
      logger.error(`newsletter: Resend unsubscribe failed: ${syncError}`)
    }
    res.json({ subscriber, sync_error: syncError })
  } catch (err) {
    sendError(res, err, logger)
  }
}
