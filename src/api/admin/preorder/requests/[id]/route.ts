import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

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
  } catch (err) {
    if (err instanceof MedusaError && err.type === MedusaError.Types.NOT_FOUND) {
      res.status(404).json({ message: "request not found" })
      return
    }
    throw err
  }
}
