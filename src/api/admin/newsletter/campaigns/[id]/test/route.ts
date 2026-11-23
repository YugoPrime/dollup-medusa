import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { buildCampaignDeps, sendError } from "../../../../../../modules/newsletter/route-deps"
import { sendTestCampaign } from "../../../../../../modules/newsletter/send-campaign"

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const to = typeof body.to === "string" ? body.to : ""
    await sendTestCampaign(buildCampaignDeps(req.scope), req.params.id, to)
    res.json({ ok: true })
  } catch (err) {
    sendError(res, err, req.scope.resolve("logger"))
  }
}
