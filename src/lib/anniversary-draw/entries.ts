import { createHash } from "crypto"

import { maskName } from "./mask-name"

/**
 * Draw window, fixed by the campaign (Mauritius, UTC+4).
 * Constants rather than env: these dates are the campaign, not configuration.
 */
export const DRAW_START = new Date("2026-07-17T00:00:00Z")
export const DRAW_END = new Date("2026-07-31T23:59:59Z")

export type RawOrder = {
  id: string
  created_at: string | Date
  email?: string | null
  sales_channel?: { id?: string | null } | null
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

export function buildPayload(
  orders: RawOrder[],
  opts: { channelId?: string | null; winnerOrderId?: string | null },
): DrawPayload {
  const { channelId, winnerOrderId } = opts

  const entries: DrawEntry[] = orders
    .map((o) => ({
      id: bubbleId(o.id),
      name: maskName({
        firstName: o.shipping_address?.first_name,
        lastName: o.shipping_address?.last_name,
        email: o.email,
      }),
      // No channel configured => nothing is an entry. Fail closed: better a
      // wall with no eligible bubbles than one that lies about eligibility.
      isEntry: Boolean(channelId) && o.sales_channel?.id === channelId,
      at: new Date(o.created_at).toISOString(),
    }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))

  let winnerId: string | null = null
  if (winnerOrderId) {
    // Accept either a raw order id or an already-hashed bubble id, so the
    // Aug 1 runbook works whichever value gets pasted into the env var.
    const hashed = bubbleId(winnerOrderId)
    if (entries.some((e) => e.id === hashed)) winnerId = hashed
    else if (entries.some((e) => e.id === winnerOrderId)) winnerId = winnerOrderId
  }

  return {
    entries,
    count: entries.length,
    entryCount: entries.filter((e) => e.isEntry).length,
    winnerId,
  }
}
