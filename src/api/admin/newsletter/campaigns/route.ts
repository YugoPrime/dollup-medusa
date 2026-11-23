import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { NEWSLETTER_MODULE } from "../../../../modules/newsletter"
import { parseList, sendError } from "../../../../modules/newsletter/route-deps"
import type NewsletterModuleService from "../../../../modules/newsletter/service"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const service = req.scope.resolve<NewsletterModuleService>(NEWSLETTER_MODULE)
    res.json({ campaigns: await service.listCampaigns() })
  } catch (err) {
    sendError(res, err, req.scope.resolve("logger"))
  }
}

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const list = parseList(body.list)
    const service = req.scope.resolve<NewsletterModuleService>(NEWSLETTER_MODULE)
    res.json({ campaign: await service.createDraft(list) })
  } catch (err) {
    sendError(res, err, req.scope.resolve("logger"))
  }
}
