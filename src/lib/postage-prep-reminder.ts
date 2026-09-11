/**
 * Pure selector + message builder behind the `postage-prep-reminder` job.
 *
 * Answers one question: which parcels still need packing this morning?
 *
 * There is no "reminded already" state anywhere. An order leaves this list only
 * when it stops qualifying — `dm_status` flipped to `ready` on the prep page,
 * or it got fulfilled/cancelled. That is what makes the 9am job keep nagging
 * about the same parcel day after day without storing a thing.
 *
 * The qualifying rules are inherited from dollup-admin/src/lib/admin-orders*.ts
 * (`isInPrep` + `getEffectiveStatus`) and must stay in sync with them, or the
 * alert and the prep page will disagree about what is outstanding. Likewise the
 * delivery-method labels come from src/api/admin/dollup/manual-orders/delivery-map.ts
 * — they are the exact `metadata.delivery_method` strings, not display names.
 *
 * Mauritius is a fixed UTC+4 with no DST, so day math is a constant shift
 * rather than a timezone library.
 */
import { escapeTelegramHtml } from "./telegram"

/** The `metadata.delivery_method` values that mean "goes out by post". */
export const POSTAGE_METHODS = [
  "Postage",
  "Express Postage",
  "Rodrigues Postage",
] as const

/** How many orders the message lists before collapsing the rest into a count. */
const MAX_LISTED = 20

const PREP_URL = "admin.dollupboutique.com/prep"

export type FulfillmentLike = {
  packed_at?: string | Date | null
  shipped_at?: string | Date | null
  delivered_at?: string | Date | null
  canceled_at?: string | Date | null
}

export type PostageOrderLike = {
  id: string
  display_id?: number | null
  status?: string | null
  fulfillments?: FulfillmentLike[] | null
  metadata?: Record<string, unknown> | null
  shipping_address?: {
    first_name?: string | null
    last_name?: string | null
  } | null
}

export type PostagePrepEntry = {
  /** "#1204" — display id when there is one, order id otherwise. */
  orderNumber: string
  deliveryMethod: string
  /** Best-effort buyer name; "" when the order carries no shipping address. */
  customer: string
  deliveryDate: string | null
  /** Whole days past the delivery date. 0 = due today or undated. */
  daysLate: number
}

function isPostageMethod(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (POSTAGE_METHODS as readonly string[]).includes(value)
  )
}

/**
 * Whether the parcel has left — i.e. the admin would show it as Delivered.
 *
 * `order.fulfillment_status` is NOT a column: Medusa's orders list/detail
 * workflows compute it (getLastFulfillmentStatus) from the fulfillments, and
 * query.graph returns it as undefined. Reading it here meant every fulfilled
 * postage order kept being nagged about. So derive it the same way: any
 * non-cancelled fulfillment that is packed, shipped or delivered lands on one
 * of the statuses in POST_FULFILLED_STATUSES in
 * dollup-admin/src/lib/admin-orders-shared.ts.
 */
function hasLeft(fulfillments: FulfillmentLike[] | null | undefined): boolean {
  return (fulfillments ?? []).some(
    (f) => !f.canceled_at && (f.packed_at || f.shipped_at || f.delivered_at),
  )
}

/** Whole days from `from` to `to`, both "YYYY-MM-DD". Negative if `to` is earlier. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`)
  const b = Date.parse(`${to}T00:00:00.000Z`)
  return Math.round((b - a) / 86_400_000)
}

/**
 * @param today YYYY-MM-DD in Mauritius time — see mauritiusToday().
 */
export function selectPostagePrep(
  orders: PostageOrderLike[],
  today: string,
): PostagePrepEntry[] {
  const entries: PostagePrepEntry[] = []

  for (const order of orders) {
    const meta = (order.metadata ?? {}) as Record<string, unknown>

    if (!isPostageMethod(meta.delivery_method)) continue
    // Already packed. This is the only thing the operator has to do to make the
    // reminder stop.
    if (meta.dm_status === "ready") continue
    if (order.status === "canceled") continue
    // Marked Delivered in the admin, even if nobody tapped Ready first.
    if (hasLeft(order.fulfillments)) continue
    // Manual-only orders can't be fulfilled in Medusa, so "gone" is a flag.
    if (meta.dm_delivered === true) continue
    // Superseded by an exchange order; the replacement carries the real work.
    if (typeof meta.replaced_by_order_id === "string") continue

    const deliveryDate =
      typeof meta.delivery_date === "string" && meta.delivery_date
        ? meta.delivery_date
        : null
    // An undated order is due now — the prep page buckets it under today too.
    const daysLate = deliveryDate ? daysBetween(deliveryDate, today) : 0
    if (daysLate < 0) continue

    const addr = order.shipping_address ?? null
    const customer = addr
      ? `${addr.first_name ?? ""} ${addr.last_name ?? ""}`.trim()
      : ""

    entries.push({
      orderNumber:
        order.display_id != null ? `#${order.display_id}` : `#${order.id}`,
      deliveryMethod: meta.delivery_method,
      customer,
      deliveryDate,
      daysLate,
    })
  }

  // Most overdue first — that is the order they should be packed in.
  return entries.sort(
    (a, b) =>
      b.daysLate - a.daysLate || a.orderNumber.localeCompare(b.orderNumber),
  )
}

function formatLine(entry: PostagePrepEntry): string {
  const parts = [
    entry.orderNumber,
    escapeTelegramHtml(entry.deliveryMethod),
    escapeTelegramHtml(entry.customer),
  ].filter(Boolean)
  if (entry.daysLate > 0) {
    parts.push(`${entry.daysLate} day${entry.daysLate === 1 ? "" : "s"} late`)
  }
  return parts.join(" · ")
}

/**
 * Telegram HTML for the morning nag, or `null` when nothing is outstanding.
 *
 * Silence on an empty list is deliberate and the opposite of the daily sales
 * report, which always speaks. A recap is only meaningful if it arrives every
 * day; a to-do nag that fires on days with nothing to do teaches you to swipe
 * it away, which is exactly the reflex this alert cannot afford.
 */
export function buildPostagePrepMessage(
  entries: PostagePrepEntry[],
): string | null {
  if (entries.length === 0) return null

  const listed = entries.slice(0, MAX_LISTED)
  const hidden = entries.length - listed.length
  const overdue = listed.filter((e) => e.daysLate > 0)
  const dueToday = listed.filter((e) => e.daysLate === 0)

  const lines = [
    `📮 <b>Postage to prepare</b> — ${entries.length} order${
      entries.length === 1 ? "" : "s"
    }`,
  ]

  if (overdue.length > 0) {
    lines.push("", "⚠️ <b>Overdue</b>", ...overdue.map(formatLine))
  }
  if (dueToday.length > 0) {
    lines.push("", "<b>Due today</b>", ...dueToday.map(formatLine))
  }
  if (hidden > 0) {
    lines.push("", `…and ${hidden} more`)
  }

  lines.push("", `Mark ready → ${PREP_URL}`)

  return lines.join("\n")
}
