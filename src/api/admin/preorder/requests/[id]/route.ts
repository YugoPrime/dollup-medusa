import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { PREORDER_MODULE } from "../../../../../modules/preorder"
import type PreorderModuleService from "../../../../../modules/preorder/service"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const svc = req.scope.resolve<PreorderModuleService>(PREORDER_MODULE)
  try {
    const request = await svc.getQuoteRequest(req.params.id, { withItems: true })
    res.json({ request })
  } catch {
    res.status(404).json({ message: "request not found" })
  }
}
