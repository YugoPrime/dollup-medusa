import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { REVIEWS_MODULE } from "../../../../modules/reviews"
import type ReviewsModuleService from "../../../../modules/reviews/service"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<ReviewsModuleService>(REVIEWS_MODULE)
  const status = (req.body as any)?.status === "rejected" ? "rejected" : "published"
  try {
    const r = await svc.moderate(req.params.id, status)
    res.json({ review: r })
  } catch (err) {
    if (err instanceof MedusaError && err.type === MedusaError.Types.NOT_FOUND) {
      res.status(404).json({ message: (err as Error).message })
      return
    }
    res.status(400).json({ message: (err as Error)?.message ?? "failed" })
  }
}
