import { classifyLink } from "./resend-event"

/**
 * Resend open + click tracking went live on dollupboutique.com at this moment
 * (Resend verified the links.dollupboutique.com record at 00:58 on 26 Nov, Mauritius time).
 * Sends before it have delivery data only: opens, clicks and unsubscribes show as "not tracked".
 */
export const OPEN_CLICK_TRACKING_SINCE = new Date("2026-11-26T00:58:00+04:00")
export const SALES_WINDOW_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

export type ResultsEvent = { type: string; email: string | null; link: string | null; occurred_at: Date }
export type ResultsOrder = {
  id: string
  display_id: number | null
  email: string | null
  created_at: Date
  total: number
  product_ids: string[]
}
export type ResultsProduct = { id: string; handle: string; title: string; thumbnail: string | null }

export type SaleRow = {
  order_id: string
  display_id: number | null
  created_at: string
  clicked_at: string
  total: number
  newsletter_items: number
}

export type CampaignResults = {
  campaign_id: string
  sent_at: string
  /** False for sends made before open/click tracking existed. */
  tracked: boolean
  /** False until the webhook has stored at least one event for this campaign. */
  has_events: boolean
  window_days: number
  window_ends_at: string
  recipients: number | null
  delivered: number | null
  bounced: number
  complained: number
  unique_opens: number | null
  unique_clicks: number | null
  /** Share of delivered emails (or of recipients when no delivery data exists), 0..1. */
  open_rate: number | null
  click_rate: number | null
  unsubscribed: number | null
  sales_after_click: { orders: number; buyers: number; total: number; rows: SaleRow[] } | null
  subscriber_sales: { orders: number; buyers: number; total: number }
  products: Array<{
    product_id: string | null
    handle: string
    title: string
    thumbnail: string | null
    in_email: boolean
    clicks: number
    unique_clicks: number
  }> | null
  other_links: Array<{ label: string; clicks: number; unique_clicks: number }> | null
  generated_at: string
}

const distinct = (events: ResultsEvent[], type: string) =>
  new Set(events.filter((e) => e.type === type && e.email).map((e) => e.email as string))

const round2 = (n: number) => Math.round(n * 100) / 100

export function computeCampaignResults(input: {
  campaign: { id: string; sent_at: Date; recipient_count: number | null; product_ids: string[] }
  events: ResultsEvent[]
  /** Emails on the list at send time; used for subscriber sales when no delivery events exist. */
  recipientsFallback: string[]
  /** Orders created from the send onwards (not cancelled, not drafts). */
  orders: ResultsOrder[]
  /** Emails on the list that unsubscribed inside the window. */
  unsubscribedInWindow: string[]
  /** Campaign products plus any other product whose page was clicked. */
  products: ResultsProduct[]
  storefrontUrl: string
  now: Date
}): CampaignResults {
  const { campaign, events, now } = input
  const sentAt = campaign.sent_at
  const windowEnd = new Date(sentAt.getTime() + SALES_WINDOW_DAYS * DAY_MS)
  const tracked = sentAt.getTime() >= OPEN_CLICK_TRACKING_SINCE.getTime()

  const delivered = distinct(events, "delivered")
  const bounced = distinct(events, "bounced")
  const complained = distinct(events, "complained")
  const opened = distinct(events, "opened")
  const clicks = events.filter((e) => e.type === "clicked" && e.email)
  const clickers = new Set(clicks.map((e) => e.email as string))

  const deliveredCount = delivered.size > 0 ? delivered.size : null
  const base = deliveredCount ?? campaign.recipient_count ?? 0
  const rate = (n: number) => (base > 0 ? n / base : null)

  // Ordered after clicking: the clicker's first click, then an order with the same email within 7 days.
  const firstClick = new Map<string, Date>()
  for (const c of clicks) {
    const prev = firstClick.get(c.email as string)
    if (!prev || c.occurred_at < prev) firstClick.set(c.email as string, c.occurred_at)
  }
  const inEmail = new Set(campaign.product_ids)
  const saleRows: SaleRow[] = []
  for (const o of input.orders) {
    const first = o.email ? firstClick.get(o.email) : undefined
    if (!first) continue
    const t = o.created_at.getTime()
    if (t < first.getTime() || t > first.getTime() + SALES_WINDOW_DAYS * DAY_MS) continue
    saleRows.push({
      order_id: o.id,
      display_id: o.display_id,
      created_at: o.created_at.toISOString(),
      clicked_at: first.toISOString(),
      total: round2(o.total),
      newsletter_items: o.product_ids.filter((id) => inEmail.has(id)).length,
    })
  }
  saleRows.sort((a, b) => a.created_at.localeCompare(b.created_at))

  // Any order from someone who received the email, within 7 days of the send.
  const recipients = delivered.size > 0 ? delivered : new Set(input.recipientsFallback)
  const subscriberOrders = input.orders.filter(
    (o) =>
      o.email &&
      recipients.has(o.email) &&
      o.created_at.getTime() >= sentAt.getTime() &&
      o.created_at.getTime() <= windowEnd.getTime()
  )

  // Bounces and complaints unsubscribe people automatically; they are not "unsubscribed" readers.
  const unsubscribed = new Set(
    input.unsubscribedInWindow.filter((e) => !bounced.has(e) && !complained.has(e))
  )

  let products: CampaignResults["products"] = null
  let otherLinks: CampaignResults["other_links"] = null
  if (tracked) {
    const byHandle = new Map<string, { clicks: number; people: Set<string> }>()
    const byLabel = new Map<string, { clicks: number; people: Set<string> }>()
    for (const c of clicks) {
      if (!c.link) continue
      const target = classifyLink(c.link, input.storefrontUrl)
      const map = target.kind === "product" ? byHandle : byLabel
      const key = target.kind === "product" ? target.handle : target.label
      const row = map.get(key) ?? { clicks: 0, people: new Set<string>() }
      row.clicks++
      row.people.add(c.email as string)
      map.set(key, row)
    }
    const productById = new Map(input.products.map((p) => [p.id, p]))
    const productByHandle = new Map(input.products.map((p) => [p.handle, p]))
    const rows: NonNullable<CampaignResults["products"]> = []
    const seen = new Set<string>()
    for (const id of campaign.product_ids) {
      const p = productById.get(id)
      if (!p || seen.has(p.handle)) continue
      seen.add(p.handle)
      const s = byHandle.get(p.handle)
      rows.push({
        product_id: p.id,
        handle: p.handle,
        title: p.title,
        thumbnail: p.thumbnail,
        in_email: true,
        clicks: s?.clicks ?? 0,
        unique_clicks: s?.people.size ?? 0,
      })
    }
    for (const [handle, s] of byHandle) {
      if (seen.has(handle)) continue
      const p = productByHandle.get(handle)
      rows.push({
        product_id: p?.id ?? null,
        handle,
        title: p?.title ?? handle,
        thumbnail: p?.thumbnail ?? null,
        in_email: inEmail.has(p?.id ?? ""),
        clicks: s.clicks,
        unique_clicks: s.people.size,
      })
    }
    // Most-clicked first; ties keep the order they had in the email.
    products = rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => b.r.unique_clicks - a.r.unique_clicks || b.r.clicks - a.r.clicks || a.i - b.i)
      .map(({ r }) => r)
    otherLinks = [...byLabel]
      .map(([label, s]) => ({ label, clicks: s.clicks, unique_clicks: s.people.size }))
      .sort((a, b) => b.unique_clicks - a.unique_clicks || b.clicks - a.clicks)
  }

  const sum = (os: Array<{ total: number }>) => round2(os.reduce((n, o) => n + o.total, 0))
  const emailByOrder = new Map(input.orders.map((o) => [o.id, o.email]))
  const clickBuyers = new Set(saleRows.map((r) => emailByOrder.get(r.order_id)).filter(Boolean)).size
  const subscriberBuyers = new Set(subscriberOrders.map((o) => o.email).filter(Boolean)).size

  return {
    campaign_id: campaign.id,
    sent_at: sentAt.toISOString(),
    tracked,
    has_events: events.length > 0,
    window_days: SALES_WINDOW_DAYS,
    window_ends_at: windowEnd.toISOString(),
    recipients: campaign.recipient_count,
    delivered: deliveredCount,
    bounced: bounced.size,
    complained: complained.size,
    unique_opens: tracked ? opened.size : null,
    unique_clicks: tracked ? clickers.size : null,
    open_rate: tracked ? rate(opened.size) : null,
    click_rate: tracked ? rate(clickers.size) : null,
    unsubscribed: tracked ? unsubscribed.size : null,
    sales_after_click: tracked
      ? {
          orders: saleRows.length,
          buyers: clickBuyers,
          total: sum(saleRows),
          rows: saleRows,
        }
      : null,
    subscriber_sales: {
      orders: subscriberOrders.length,
      buyers: subscriberBuyers,
      total: sum(subscriberOrders),
    },
    products,
    other_links: otherLinks,
    generated_at: now.toISOString(),
  }
}
