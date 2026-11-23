import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import {
  buildCampaignDeps,
  parseExpectedList,
  sendError,
} from "../../../../../../modules/newsletter/route-deps"
import { sendCampaign } from "../../../../../../modules/newsletter/send-campaign"

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>
    const trimmed = typeof body.sent_by === "string" ? body.sent_by.trim() : ""
    const sentBy = trimmed ? trimmed.slice(0, 100) : null
    const expectedList = parseExpectedList(body.expected_list)
    const campaign = await sendCampaign(
      buildCampaignDeps(req.scope),
      req.params.id,
      sentBy,
      expectedList,
    )
    res.json({ campaign })
  } catch (err) {
    sendError(res, err, req.scope.resolve("logger"))
  }
}
