import { computeCampaignResults, type ResultsEvent, type ResultsOrder } from "../lib/results"

const SENT = new Date("2026-11-28T06:00:00Z") // after tracking went live
const at = (h: number) => new Date(SENT.getTime() + h * 60 * 60 * 1000)
const ev = (type: string, email: string, h: number, link: string | null = null): ResultsEvent => ({
  type,
  email,
  link,
  occurred_at: at(h),
})
const order = (id: string, email: string, h: number, total: number, product_ids: string[] = []): ResultsOrder => ({
  id,
  display_id: Number(id.replace(/\D/g, "")) || null,
  email,
  created_at: at(h),
  total,
  product_ids,
})
const P = "https://dollupboutique.com/products/"

function run(over: Partial<Parameters<typeof computeCampaignResults>[0]> = {}) {
  return computeCampaignResults({
    campaign: { id: "nlcamp_1", sent_at: SENT, recipient_count: 4, product_ids: ["prod_a", "prod_b", "prod_c"] },
    events: [
      ev("delivered", "a@x.com", 0),
      ev("delivered", "b@x.com", 0),
      ev("delivered", "c@x.com", 0),
      ev("bounced", "d@x.com", 0),
      ev("opened", "a@x.com", 1),
      ev("opened", "a@x.com", 2),
      ev("opened", "b@x.com", 1),
      ev("clicked", "a@x.com", 2, P + "dress-b?utm_source=newsletter"),
      ev("clicked", "a@x.com", 3, P + "dress-b?utm_source=newsletter"),
      ev("clicked", "b@x.com", 5, P + "dress-a"),
      ev("clicked", "b@x.com", 5, "https://dollupboutique.com/sale?utm_source=newsletter"),
    ],
    recipientsFallback: [],
    orders: [
      order("o1", "a@x.com", 4, 1890, ["prod_b", "prod_z"]), // after a's click: counts
      order("o2", "b@x.com", 1, 990), // before b's click: subscriber sale only
      order("o3", "c@x.com", 30, 500), // never clicked: subscriber sale only
      order("o4", "z@x.com", 10, 700), // not a recipient: nothing
      order("o5", "a@x.com", 2 + 24 * 8, 400), // 8 days after a's first click: nothing
    ],
    unsubscribedInWindow: ["c@x.com", "d@x.com"],
    products: [
      { id: "prod_a", handle: "dress-a", title: "Dress A", thumbnail: null },
      { id: "prod_b", handle: "dress-b", title: "Dress B", thumbnail: "b.jpg" },
      { id: "prod_c", handle: "dress-c", title: "Dress C", thumbnail: null },
    ],
    storefrontUrl: "https://dollupboutique.com",
    now: at(48),
    ...over,
  })
}

describe("computeCampaignResults", () => {
  it("counts unique people and rates against delivered", () => {
    const r = run()
    expect(r.tracked).toBe(true)
    expect(r.delivered).toBe(3)
    expect(r.bounced).toBe(1)
    expect(r.unique_opens).toBe(2)
    expect(r.unique_clicks).toBe(2)
    expect(r.click_rate).toBeCloseTo(2 / 3)
  })

  it("credits only orders placed within 7 days after the buyer's first click", () => {
    const r = run()
    expect(r.sales_after_click).toMatchObject({ orders: 1, buyers: 1, total: 1890 })
    expect(r.sales_after_click?.rows[0]).toMatchObject({ order_id: "o1", newsletter_items: 1 })
  })

  it("counts every recipient's order within 7 days of the send", () => {
    expect(run().subscriber_sales).toEqual({ orders: 3, buyers: 3, total: 3380 })
  })

  it("does not count bounced addresses as unsubscribes", () => {
    expect(run().unsubscribed).toBe(1)
  })

  it("ranks products by unique clicks, keeps unclicked ones, and groups other links", () => {
    const r = run()
    expect(r.products?.map((p) => [p.handle, p.unique_clicks, p.clicks])).toEqual([
      ["dress-b", 1, 2],
      ["dress-a", 1, 1],
      ["dress-c", 0, 0],
    ])
    expect(r.other_links).toEqual([{ label: "/sale", clicks: 1, unique_clicks: 1 }])
  })

  it("hides opens, clicks and click sales for sends before tracking, but keeps delivery and subscriber sales", () => {
    const old = new Date("2026-11-25T17:13:14Z")
    const r = run({
      campaign: { id: "nlcamp_0", sent_at: old, recipient_count: 169, product_ids: [] },
      events: [{ type: "delivered", email: "a@x.com", link: null, occurred_at: old }],
      orders: [{ ...order("o9", "a@x.com", 0, 1200), created_at: new Date(old.getTime() + 3600_000) }],
    })
    expect(r.tracked).toBe(false)
    expect(r.unique_opens).toBeNull()
    expect(r.click_rate).toBeNull()
    expect(r.sales_after_click).toBeNull()
    expect(r.products).toBeNull()
    expect(r.unsubscribed).toBeNull()
    expect(r.delivered).toBe(1)
    expect(r.subscriber_sales.total).toBe(1200)
  })

  it("falls back to the list at send time when no delivery events exist yet", () => {
    const r = run({ events: [], recipientsFallback: ["c@x.com"] })
    expect(r.has_events).toBe(false)
    expect(r.delivered).toBeNull()
    expect(r.click_rate).toBe(0) // 0 of the 4 recipients
    expect(r.subscriber_sales.orders).toBe(1)
  })
})
