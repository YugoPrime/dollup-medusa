// Picks orders by their delivery day (metadata.delivery_date, yyyy-mm-dd).
// Medusa's order list can't filter on metadata, so the dollup-admin prep page
// used to load orders by creation date only and missed any order taken more
// than ~60 days before its delivery day (#923: taken 31 Aug for 30 Nov).

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000
// The widest range a caller needs is the prep date strip (a week); two months
// leaves room without letting one call read the whole order history.
const MAX_RANGE_DAYS = 62
// How far before its delivery day an order can have been taken.
const LOOKBACK_DAYS = 365

export type DayRange = { from: string; to: string }

type OrderLike = {
  id: string
  status?: string | null
  metadata?: Record<string, unknown> | null
}

// Noon in Mauritius (UTC+4, no DST), so whole-day steps never change the date.
function muNoon(day: string): number {
  return Date.parse(`${day}T12:00:00.000+04:00`)
}

function isRealDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false
  const ms = muNoon(value)
  // Round-trip, so 2026-02-31 (which rolls over to 3 Mar) is refused.
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value
}

export function parseDayRange(
  query: Record<string, unknown>,
): DayRange | { error: string } {
  const { from, to } = query
  if (!isRealDay(from) || !isRealDay(to)) {
    return { error: "from and to must be days written yyyy-mm-dd" }
  }
  if (from > to) return { error: "from must not be after to" }
  if ((muNoon(to) - muNoon(from)) / DAY_MS > MAX_RANGE_DAYS) {
    return { error: `The range can't be longer than ${MAX_RANGE_DAYS} days` }
  }
  return { from, to }
}

// Earliest creation time worth reading for orders delivered from `from` on.
export function createdSinceFor(from: string): string {
  return new Date(muNoon(from) - LOOKBACK_DAYS * DAY_MS).toISOString()
}

export function idsWithDeliveryDateBetween(
  orders: OrderLike[],
  from: string,
  to: string,
): string[] {
  return orders
    .filter((o) => {
      if (o.status === "canceled") return false
      const day = o.metadata?.delivery_date
      return typeof day === "string" && day !== "" && day >= from && day <= to
    })
    .map((o) => o.id)
}
