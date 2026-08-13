/**
 * Pure summarizer + message builder behind the `daily-sales-report` job.
 *
 * Revenue basis: **orders placed**. Every non-cancelled order counts on the day
 * it was created, whether or not the cash has landed. Doll Up is mostly COD, so
 * a "collected" basis would push a Monday order onto Thursday and make the
 * daily number a lagging, spiky mess. Placed revenue measures demand and
 * matches what dollup-admin's dashboard already shows, so the two never
 * disagree in front of you.
 *
 * Two rules are inherited from dollup-admin/src/lib/dashboard-analytics.ts and
 * must stay in sync with it:
 *
 *   - Cancelled orders are excluded. Medusa spells the status "canceled".
 *   - Net revenue is `total - exchange_credit_mur`. On an exchange, Medusa
 *     stores the full goods value in `total` but only the difference is
 *     actually paid; counting the gross would invent revenue.
 *
 * Mauritius is a fixed UTC+4 with no DST, so day bucketing is a constant shift
 * rather than a timezone library.
 */

const MU_OFFSET_MS = 4 * 60 * 60 * 1000

export type OrderLike = {
  id: string
  created_at: string | Date
  status?: string | null
  total?: unknown
  metadata?: Record<string, unknown> | null
}

export type SalesTotals = {
  orders: number
  revenueMur: number
  averageOrderMur: number
}

export type SalesBreakdownRow = {
  label: string
  orders: number
  revenueMur: number
}

export type DailySalesReport = {
  /** YYYY-MM-DD in Mauritius time. */
  day: string
  today: SalesTotals
  previousDay: SalesTotals
  sameDayLastWeek: SalesTotals
  byChannel: SalesBreakdownRow[]
  byPaymentMethod: SalesBreakdownRow[]
}

/** YYYY-MM-DD for the Mauritius calendar day an instant falls in. */
export function muDay(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value)
  return new Date(d.getTime() + MU_OFFSET_MS).toISOString().slice(0, 10)
}

/** Shifts a YYYY-MM-DD by whole days without touching the local timezone. */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Medusa v2 returns BigNumber objects for totals. Number() invokes valueOf()
 * and yields the real value — a hand-rolled `.value` lookup silently returns 0,
 * which is exactly how a totals bug ships unnoticed.
 */
function toMur(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.round(n) : 0
}

export function isCountableOrder(order: OrderLike): boolean {
  const status = (order.status ?? "").toLowerCase()
  // Medusa spells it "canceled"; accept both so a future rename can't silently
  // start counting cancelled orders as revenue.
  return status !== "canceled" && status !== "cancelled"
}

export function netRevenueMur(order: OrderLike): number {
  const meta = order.metadata ?? {}
  const credit =
    typeof meta.exchange_credit_mur === "number"
      ? Math.round(meta.exchange_credit_mur)
      : 0
  return toMur(order.total) - credit
}

/** WEB unless the order was raised through the DM admin. */
export function channelOf(order: OrderLike): string {
  const meta = order.metadata ?? {}
  if (typeof meta.point_of_sale === "string" && meta.point_of_sale.trim()) {
    return meta.point_of_sale.trim()
  }
  return meta.source === "dm_admin" ? "DM" : "WEB"
}

export function paymentMethodOf(order: OrderLike): string {
  const meta = order.metadata ?? {}
  if (typeof meta.payment_method === "string" && meta.payment_method.trim()) {
    return meta.payment_method.trim()
  }
  return "Unspecified"
}

function totalsOf(orders: OrderLike[]): SalesTotals {
  const revenueMur = orders.reduce((sum, o) => sum + netRevenueMur(o), 0)
  return {
    orders: orders.length,
    revenueMur,
    averageOrderMur: orders.length
      ? Math.round(revenueMur / orders.length)
      : 0,
  }
}

function breakdown(
  orders: OrderLike[],
  labelOf: (o: OrderLike) => string,
): SalesBreakdownRow[] {
  const rows = new Map<string, SalesBreakdownRow>()
  for (const order of orders) {
    const label = labelOf(order)
    const row = rows.get(label) ?? { label, orders: 0, revenueMur: 0 }
    row.orders++
    row.revenueMur += netRevenueMur(order)
    rows.set(label, row)
  }
  return [...rows.values()].sort((a, b) => b.revenueMur - a.revenueMur)
}

/**
 * `orders` must span at least the 8 Mauritius days ending at `day` so the
 * week-ago comparison has data. Anything outside the buckets is ignored.
 */
export function buildDailySalesReport(
  orders: OrderLike[],
  day: string,
): DailySalesReport {
  const countable = orders.filter(isCountableOrder)
  const onDay = (target: string) =>
    countable.filter((o) => muDay(o.created_at) === target)

  const todayOrders = onDay(day)

  return {
    day,
    today: totalsOf(todayOrders),
    previousDay: totalsOf(onDay(shiftDay(day, -1))),
    sameDayLastWeek: totalsOf(onDay(shiftDay(day, -7))),
    byChannel: breakdown(todayOrders, channelOf),
    byPaymentMethod: breakdown(todayOrders, paymentMethodOf),
  }
}

export function formatMur(amount: number): string {
  return `Rs ${Math.round(amount).toLocaleString("en-US")}`
}

/**
 * Returns null when there is no prior figure to compare against — showing
 * "+100%" against a zero baseline is noise, not information.
 */
export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

function comparisonLine(
  label: string,
  current: number,
  previous: SalesTotals,
): string {
  if (previous.orders === 0) {
    return `${label}: no orders`
  }
  const change = percentChange(current, previous.revenueMur)
  const arrow = change === null ? "" : change > 0 ? "▲" : change < 0 ? "▼" : "="
  const pct = change === null ? "" : ` ${arrow} ${Math.abs(change)}%`
  return `${label}: ${formatMur(previous.revenueMur)}${pct}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export function buildDailySalesMessage(report: DailySalesReport): string {
  const { today } = report
  const lines: string[] = []

  lines.push(`📊 <b>Doll Up — ${report.day}</b>`)
  lines.push("")

  if (today.orders === 0) {
    lines.push("<b>No orders.</b>")
    lines.push("")
    lines.push(comparisonLine("Day before", 0, report.previousDay))
    lines.push(comparisonLine("Same day last week", 0, report.sameDayLastWeek))
    return lines.join("\n")
  }

  lines.push(`<b>${formatMur(today.revenueMur)}</b> from ${today.orders} order${today.orders === 1 ? "" : "s"}`)
  lines.push(`Average order ${formatMur(today.averageOrderMur)}`)
  lines.push("")

  lines.push(comparisonLine("Day before", today.revenueMur, report.previousDay))
  lines.push(
    comparisonLine("Same day last week", today.revenueMur, report.sameDayLastWeek),
  )

  if (report.byChannel.length > 0) {
    lines.push("")
    lines.push("<b>Channel</b>")
    for (const row of report.byChannel) {
      lines.push(
        `  ${escapeHtml(row.label)} — ${formatMur(row.revenueMur)} (${row.orders})`,
      )
    }
  }

  if (report.byPaymentMethod.length > 0) {
    lines.push("")
    lines.push("<b>Payment</b>")
    for (const row of report.byPaymentMethod) {
      lines.push(
        `  ${escapeHtml(row.label)} — ${formatMur(row.revenueMur)} (${row.orders})`,
      )
    }
  }

  return lines.join("\n")
}
