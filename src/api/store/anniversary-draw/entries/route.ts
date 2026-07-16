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
//
// `metadata` is load-bearing, not incidental: eligibility (buildPayload's
// isWebsiteOrder) keys off the presence of `metadata.cart_type`. Trimming
// this field as "unused PII" would silently make every order non-eligible —
// see src/lib/anniversary-draw/entries.ts for the full rationale. metadata
// itself DOES contain PII on some orders (phone numbers, notes) and must
// never be forwarded past buildPayload into the response payload.
const ORDER_FIELDS = [
  "id",
  "created_at",
  "email",
  "metadata",
  "shipping_address.first_name",
  "shipping_address.last_name",
]

// Cap on the order query. If this is hit, the bubble wall may be incomplete
// and could disagree with draw_winner.py (which paginates through all orders
// to pick the official winner). Silent truncation here would be invisible.
const ORDER_TAKE = 1000

export const GET = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  const payload = await cached(async () => {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ORDER_FIELDS,
      filters: {
        created_at: { $gte: DRAW_START, $lte: DRAW_END },
      } as never,
      pagination: { take: ORDER_TAKE },
    })

    // Silent truncation at the cap would be invisible. Log a warning if we hit it
    // so the condition is visible in logs rather than silently breaking the draw.
    if ((orders?.length ?? 0) >= ORDER_TAKE) {
      console.warn(
        `[anniversary-draw] hit the ${ORDER_TAKE}-order cap — the wall may be missing entries ` +
          `and could disagree with draw_winner.py. Raise the cap or paginate.`,
      )
    }

    return buildPayload((orders ?? []) as RawOrder[], {
      winnerOrderId: process.env.ANNIVERSARY_DRAW_WINNER_ID ?? null,
    })
  })

  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  res.json(payload)
}
