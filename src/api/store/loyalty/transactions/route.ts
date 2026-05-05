import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"

import { LOYALTY_MODULE } from "../../../../modules/loyalty"
import type LoyaltyModuleService from "../../../../modules/loyalty/service"

/**
 * GET /store/loyalty/transactions?limit=50&offset=0
 *
 * Auth: customer.
 * Returns the customer's transaction history newest-first.
 */
export const GET = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    res.status(401).json({ message: "Unauthorized" })
    return
  }

  const limit = parseQueryInt(req.query.limit, 50, 1, 200)
  const offset = parseQueryInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER)

  const loyaltyService = req.scope.resolve<LoyaltyModuleService>(LOYALTY_MODULE)
  const result = await loyaltyService.listTransactions(customerId, {
    limit,
    offset,
  })

  res.json({
    transactions: result.items.map((t) => ({
      id: t.id,
      type: t.type,
      points: t.points,
      reason: t.reason,
      order_id: t.order_id,
      created_at: t.created_at,
    })),
    count: result.count,
    limit: result.limit,
    offset: result.offset,
  })
}

function parseQueryInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === null || raw === "") return fallback
  const n = Number.parseInt(String(raw), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}
