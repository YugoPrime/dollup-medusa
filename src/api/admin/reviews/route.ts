import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { REVIEWS_MODULE } from "../../../modules/reviews"
import type ReviewsModuleService from "../../../modules/reviews/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<ReviewsModuleService>(REVIEWS_MODULE)
  const status = (req.query.status as string) || undefined
  const rows = await svc.listProductReviews(status ? { status } : {}, {
    order: { created_at: "DESC" }, take: 100,
  })
  res.json({ reviews: rows })
}
