import { createHash } from "crypto"

import { maskName } from "./mask-name"

/**
 * Draw window, fixed by the campaign (Mauritius, UTC+4).
 * Constants rather than env: these dates are the campaign, not configuration.
 *
 * The `+04:00` offset is deliberate and must NOT be "simplified" to `Z` —
 * that would shift the window by 4 hours (silently dropping midnight-4am
 * orders on launch day and including 4 extra hours after close). Written
 * in local time so the constants are self-documenting; the equivalent UTC
 * instants are 2026-07-16T20:00:00.000Z and 2026-07-31T19:59:59.000Z.
 */
export const DRAW_START = new Date("2026-07-17T00:00:00+04:00")
export const DRAW_END = new Date("2026-07-31T23:59:59+04:00")

export type RawOrder = {
  id: string
  created_at: string | Date
  email?: string | null
  metadata?: Record<string, unknown> | null
  shipping_address?: { first_name?: string | null; last_name?: string | null } | null
}

export type DrawEntry = {
  id: string
  name: string
  isEntry: boolean
  at: string
}

export type DrawPayload = {
  entries: DrawEntry[]
  count: number
  entryCount: number
  winnerId: string | null
}

/**
 * Public, opaque bubble id. Deliberately NOT display_id — that would put
 * enumerable order numbers on a public endpoint.
 *
 * CROSS-LANGUAGE CONTRACT: draw_winner.py computes this identically
 * (sha256 hex, first 6 chars). Changing it here breaks the Aug 1 reveal.
 */
export function bubbleId(orderId: string): string {
  return createHash("sha256").update(orderId).digest("hex").slice(0, 6)
}

/**
 * Eligibility rule: website vs. DM/manual order.
 *
 * WHY NOT SALES CHANNEL: Doll Up has exactly ONE sales channel. Manual/DM
 * orders created by staff are stamped with that same channel as website
 * orders — there is no channel-based signal to split on. An earlier version
 * of this rule keyed off `sales_channel.id`, which meant every DM order
 * would render as an eligible entry (and could even be drawn as the
 * winner), directly contradicting the page's own published terms that only
 * website orders are eligible. Do not reintroduce a channel/source check as
 * a "simplification" — it silently reopens that bug because this store
 * only ever has one channel.
 *
 * THE VERIFIED DISCRIMINATOR: an order is a website order if and only if
 * its `metadata` object contains the key `cart_type` — regardless of that
 * key's value. This key is written by the storefront's cart provider
 * (DUB-front/src/components/cart/CartProvider.tsx), so only carts that
 * actually went through the site ever carry it. Verified against all 543
 * production orders at the time of this fix: the key is present on 0 of
 * the 459 known DM/manual orders (`metadata.source` of `dm_admin` or
 * `hermes`), and present on all 55 known website orders.
 *
 * WHY KEY PRESENCE, NOT TRUTHINESS: 2 real website orders have
 * `cart_type: null` in metadata (the cart provider clears the value when a
 * cart is emptied and re-added, but the key itself stays). Those are real
 * customers who ordered through the site and must get their entry. A
 * truthiness check (`o.metadata?.cart_type`) would wrongly exclude them.
 * Checking `"cart_type" in metadata` is the only correct test.
 *
 * WHY THIS FAILS CLOSED: if `metadata` is ever dropped from the order
 * query's field list (see ORDER_FIELDS in the route), every order's
 * metadata becomes undefined, `"cart_type" in {}` is false, and every
 * order becomes non-eligible. The wall then visibly shows zero entries —
 * a loud, obvious break — rather than every DM order silently glowing as
 * eligible. That direction is deliberate; never invert it to fail open.
 */
function isWebsiteOrder(metadata: RawOrder["metadata"]): boolean {
  return Boolean(metadata) && Object.prototype.hasOwnProperty.call(metadata, "cart_type")
}

export function buildPayload(
  orders: RawOrder[],
  opts: { winnerOrderId?: string | null },
): DrawPayload {
  const { winnerOrderId } = opts

  const entries: DrawEntry[] = orders
    .map((o) => ({
      id: bubbleId(o.id),
      name: maskName({
        firstName: o.shipping_address?.first_name,
        lastName: o.shipping_address?.last_name,
        email: o.email,
      }),
      isEntry: isWebsiteOrder(o.metadata),
      at: new Date(o.created_at).toISOString(),
    }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))

  let winnerId: string | null = null
  if (winnerOrderId) {
    // Accept either a raw order id or an already-hashed bubble id, so the
    // Aug 1 runbook works whichever value gets pasted into the env var.
    const hashed = bubbleId(winnerOrderId)
    // The winner must be an eligible entry. A DM/manual order set as the
    // winner would render gold on a wall that marks it as not-an-entry,
    // contradicting the page's own terms — so only resolve against
    // entries whose isEntry is true.
    const match = entries.find((e) => e.isEntry && (e.id === hashed || e.id === winnerOrderId))
    if (match) {
      winnerId = match.id
    } else {
      // Truthy winnerOrderId that resolves to nothing (typo, order outside
      // the draw window, or a non-eligible order) must not fail silently —
      // this is the single highest-stakes day and a silent null here means
      // "Drawing now…" forever with no gold bubble and no diagnostic trail.
      console.warn(
        `[anniversary-draw] ANNIVERSARY_DRAW_WINNER_ID "${winnerOrderId}" did not resolve to ` +
          `an eligible entry in this order set (checked ${entries.length} entries). ` +
          `Possible causes: typo, order outside the draw window, or a non-eligible ` +
          `(DM/manual) order id. winnerId will be null and the wall will show no winner.`,
      )
    }
  }

  return {
    entries,
    count: entries.length,
    entryCount: entries.filter((e) => e.isEntry).length,
    winnerId,
  }
}
