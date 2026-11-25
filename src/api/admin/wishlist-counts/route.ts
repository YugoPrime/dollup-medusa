import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { WISHLIST_SIGNALS_MODULE } from "../../../modules/wishlist-signals"
import type WishlistSignalsModuleService from "../../../modules/wishlist-signals/service"

/**
 * GET /admin/wishlist-counts
 * { counts: [{ product_id, guests, customer_ids }], browsers }
 */
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve<WishlistSignalsModuleService>(WISHLIST_SIGNALS_MODULE)
  res.json(await service.countsByProduct())
}
