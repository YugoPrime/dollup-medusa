import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { STORIES_MODULE } from "../../../../modules/stories"
import type StoriesModuleService from "../../../../modules/stories/service"

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const days = Math.max(1, Math.min(60, Number(req.query.days ?? 7)))
  const service = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const excluded = await service.getExcludedProductIds(days)
  res.json({
    days,
    used_in_window: excluded.length,
    excluded_product_ids: excluded,
  })
}
