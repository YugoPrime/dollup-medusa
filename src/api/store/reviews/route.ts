import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { REVIEWS_MODULE } from "../../../modules/reviews"
import type ReviewsModuleService from "../../../modules/reviews/service"

export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const svc = req.scope.resolve<ReviewsModuleService>(REVIEWS_MODULE)
  const b = req.body as any
  try {
    const r = await svc.createReview({
      order_id: b?.order_id, product_id: b?.product_id,
      email: b?.email, rating: b?.rating, body: b?.body,
    })
    res.json({ id: r.id, status: r.status })
  } catch (e) {
    res.status(400).json({ message: e instanceof Error ? e.message : "Could not submit review." })
  }
}
