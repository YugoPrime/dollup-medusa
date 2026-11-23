import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { NEWSLETTER_MODULE } from "../../../../../modules/newsletter"
import { assertEditable, parseCampaignPatch } from "../../../../../modules/newsletter/campaign-rules"
import { makeWithLock, sendError } from "../../../../../modules/newsletter/route-deps"
import type { CampaignDeps } from "../../../../../modules/newsletter/send-campaign"

const serviceOf = (req: AuthenticatedMedusaRequest) =>
  req.scope.resolve(NEWSLETTER_MODULE) as unknown as CampaignDeps["service"] & {
    deleteNewsletterCampaigns: (id: string) => Promise<void>
  }

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    res.json({ campaign: await serviceOf(req).retrieveNewsletterCampaign(req.params.id) })
  } catch (err) {
    sendError(res, err, req.scope.resolve("logger"))
  }
}

// Update and delete take the same lock as sendCampaign, so an edit can't land
// after a send flipped the campaign to "sending".
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const service = serviceOf(req)
    const id = req.params.id
    const campaign = await makeWithLock(req.scope)("newsletter-send:" + id, async () => {
      const current = await service.retrieveNewsletterCampaign(id)
      assertEditable(current)
      const patch = parseCampaignPatch(req.body)
      return service.updateNewsletterCampaigns({ id, ...patch })
    })
    res.json({ campaign })
  } catch (err) {
    sendError(res, err, req.scope.resolve("logger"))
  }
}

export const DELETE = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const service = serviceOf(req)
    const id = req.params.id
    await makeWithLock(req.scope)("newsletter-send:" + id, async () => {
      assertEditable(await service.retrieveNewsletterCampaign(id))
      await service.deleteNewsletterCampaigns(id)
    })
    res.json({ id, deleted: true })
  } catch (err) {
    sendError(res, err, req.scope.resolve("logger"))
  }
}
