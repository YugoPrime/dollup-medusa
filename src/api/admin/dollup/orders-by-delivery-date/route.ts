import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  createdSinceFor,
  idsWithDeliveryDateBetween,
  parseDayRange,
} from "./select"

/**
 * GET /admin/dollup/orders-by-delivery-date?from=yyyy-mm-dd&to=yyyy-mm-dd
 *
 * Ids of the non-cancelled orders whose metadata.delivery_date is between
 * `from` and `to` (both included). Used by dollup-admin (prep, labels, courier
 * sheet, planning) to find orders taken long before their delivery day, which
 * its creation-date window can't reach. The admin then loads the full orders
 * through the normal order list, by id.
 *
 * query.graph can't filter on metadata, so this reads id/status/metadata of the
 * orders taken in the year before `from` and picks in JS. Those three columns
 * are cheap, unlike /admin/orders, which loads items and totals per order.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const range = parseDayRange(req.query as Record<string, unknown>)
  if ("error" in range) {
    res.status(400).json({ message: range.error })
    return
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "status", "metadata"],
    filters: { created_at: { $gte: createdSinceFor(range.from) } },
  })

  const orders = (data ?? []).filter(
    (o): o is NonNullable<typeof o> => o != null,
  )
  res.json({ ids: idsWithDeliveryDateBetween(orders, range.from, range.to) })
}
