import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"

import { WISHLIST_SIGNALS_MODULE } from "../../../modules/wishlist-signals"
import type WishlistSignalsModuleService from "../../../modules/wishlist-signals/service"
import { parseWishlistEvent } from "../../../modules/wishlist-signals/validate"

/**
 * POST /store/wishlist-events
 *
 * The storefront reports wishlist hearts here (lib/wishlist-client.ts), so the
 * admin Restock report can count guest wishlists, not only signed-in ones.
 * Body: { anon_id, customer_id?, action: "add" | "remove", product_ids }.
 */
export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const parsed = parseWishlistEvent(req.body)
  if ("error" in parsed) {
    res.status(400).json({ message: parsed.error })
    return
  }
  const service = req.scope.resolve<WishlistSignalsModuleService>(WISHLIST_SIGNALS_MODULE)
  await service.recordEvent(parsed.event)
  res.json({ ok: true })
}
