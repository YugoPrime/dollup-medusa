import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { cached } from "../../../../lib/anniversary-draw/cache"
import {
  buildPayload,
  DRAW_END,
  DRAW_START,
  type RawOrder,
} from "../../../../lib/anniversary-draw/entries"

/**
 * GET /store/anniversary-draw/entries
 *
 * Public, unauthenticated. Powers the Rs 2,000 anniversary draw bubble wall
 * on the storefront (/events/anniversary/draw).
 *
 * Why this lives in the backend rather than the storefront: order data sits
 * behind the admin API. Masking here means the storefront never needs admin
 * credentials and no PII ever leaves this process — the response carries only
 * a masked name, an opaque id, an eligibility flag and a timestamp.
 */

// Only what masking and bucketing need. Anything more would be PII we'd then
// have to be careful to drop.
const ORDER_FIELDS = [
  "id",
  "created_at",
  "email",
  "sales_channel.id",
  "shipping_address.first_name",
  "shipping_address.last_name",
]

export const GET = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const payload = await cached(async () => {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ORDER_FIELDS,
      filters: {
        created_at: { $gte: DRAW_START, $lte: DRAW_END },
      } as never,
      pagination: { take: 1000 },
    })

    return buildPayload((orders ?? []) as RawOrder[], {
      channelId: process.env.ANNIVERSARY_DRAW_CHANNEL_ID ?? null,
      winnerOrderId: process.env.ANNIVERSARY_DRAW_WINNER_ID ?? null,
    })
  })

  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  res.json(payload)
}
