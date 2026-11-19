// Mauritius is UTC+4 all year, no DST.
const MU_OFFSET_MS = 4 * 60 * 60 * 1000

/**
 * Advent doors 7, 14 and 21 Dec 2026 (Mauritius time).
 * Must stay equal to the door dates in DUB-front src/lib/advent.ts.
 */
export const DOUBLE_POINTS_MU_DATES: readonly string[] = ["2026-12-07", "2026-12-14", "2026-12-21"]

/** MU calendar day for an instant, "YYYY-MM-DD". Reads UTC parts after a +4h shift, so the server's timezone is irrelevant. */
export function muYmd(at: Date | string): string {
  const d = at instanceof Date ? at : new Date(at)
  return new Date(d.getTime() + MU_OFFSET_MS).toISOString().slice(0, 10)
}

/** 2 for a website in-stock order placed on a double-points MU day, else 1. */
export function loyaltyMultiplier(order: {
  created_at?: Date | string | null
  metadata?: Record<string, unknown> | null
}): 1 | 2 {
  if (!order.created_at) return 1
  if (order.metadata?.cart_type !== "instock") return 1
  const d = order.created_at instanceof Date ? order.created_at : new Date(order.created_at)
  if (Number.isNaN(d.getTime())) return 1
  return DOUBLE_POINTS_MU_DATES.includes(muYmd(d)) ? 2 : 1
}
