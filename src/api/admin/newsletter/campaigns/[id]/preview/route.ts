import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { buildCampaignDeps, sendError } from "../../../../../../modules/newsletter/route-deps"
import { previewCampaign } from "../../../../../../modules/newsletter/send-campaign"

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const out = await previewCampaign(buildCampaignDeps(req.scope), req.params.id)
    res.json({
      html: out.html,
      dropped: out.dropped,
      card_count: out.cardCount,
      recipient_estimate: out.recipientEstimate,
      unsynced_count: out.unsyncedCount,
    })
  } catch (err) {
    sendError(res, err, req.scope.resolve("logger"))
  }
}
