import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REVIEWS_MODULE } from "../../../../modules/reviews"
import type ReviewsModuleService from "../../../../modules/reviews/service"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<ReviewsModuleService>(REVIEWS_MODULE)
  const status = (req.body as any)?.status === "rejected" ? "rejected" : "published"
  const r = await svc.moderate(req.params.id, status)
  res.json({ review: r })
}
