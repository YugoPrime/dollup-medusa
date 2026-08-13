import {
  buildDailySalesMessage,
  buildDailySalesReport,
  channelOf,
  formatMur,
  isCountableOrder,
  muDay,
  netRevenueMur,
  paymentMethodOf,
  percentChange,
  shiftDay,
  type OrderLike,
} from "../daily-sales-report"

let seq = 0
const order = (over: Partial<OrderLike> & { created_at: string }): OrderLike => ({
  id: `order_${++seq}`,
  status: "pending",
  total: 1000,
  metadata: {},
  ...over,
})

describe("muDay", () => {
  it("shifts UTC into Mauritius (+4) before taking the date", () => {
    // 21:00 UTC is already the next day in Mauritius.
    expect(muDay("2026-08-13T21:00:00.000Z")).toBe("2026-08-14")
    expect(muDay("2026-08-13T19:59:00.000Z")).toBe("2026-08-13")
  })

  it("puts local midnight in Mauritius on the right day", () => {
    // 2026-08-14 00:30 MU === 2026-08-13 20:30 UTC
    expect(muDay("2026-08-13T20:30:00.000Z")).toBe("2026-08-14")
  })
})

describe("shiftDay", () => {
  it("moves whole days and crosses month boundaries", () => {
    expect(shiftDay("2026-08-14", -1)).toBe("2026-08-13")
    expect(shiftDay("2026-08-14", -7)).toBe("2026-08-07")
    expect(shiftDay("2026-09-01", -1)).toBe("2026-08-31")
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31")
  })
})

describe("isCountableOrder", () => {
  it("excludes cancelled orders under either spelling", () => {
    expect(isCountableOrder(order({ created_at: "x", status: "canceled" }))).toBe(false)
    expect(isCountableOrder(order({ created_at: "x", status: "cancelled" }))).toBe(false)
    expect(isCountableOrder(order({ created_at: "x", status: "pending" }))).toBe(true)
  })
})

describe("netRevenueMur", () => {
  it("reads a BigNumber-like total through valueOf", () => {
    const bigNumber = { valueOf: () => 2665 }
    expect(netRevenueMur(order({ created_at: "x", total: bigNumber }))).toBe(2665)
  })

  it("deducts exchange credit, since only the difference is actually paid", () => {
    const o = order({
      created_at: "x",
      total: 3000,
      metadata: { exchange_credit_mur: 1200 },
    })
    expect(netRevenueMur(o)).toBe(1800)
  })

  it("treats a missing or unparseable total as zero rather than NaN", () => {
    expect(netRevenueMur(order({ created_at: "x", total: null }))).toBe(0)
    expect(netRevenueMur(order({ created_at: "x", total: "abc" }))).toBe(0)
  })
})

describe("channelOf / paymentMethodOf", () => {
  it("defaults storefront orders to WEB and DM-admin orders to DM", () => {
    expect(channelOf(order({ created_at: "x", metadata: {} }))).toBe("WEB")
    expect(channelOf(order({ created_at: "x", metadata: { source: "dm_admin" } }))).toBe("DM")
  })

  it("prefers an explicit point_of_sale", () => {
    expect(
      channelOf(order({ created_at: "x", metadata: { source: "dm_admin", point_of_sale: "Instagram" } })),
    ).toBe("Instagram")
  })

  it("labels a missing payment method rather than dropping the order", () => {
    expect(paymentMethodOf(order({ created_at: "x", metadata: {} }))).toBe("Unspecified")
    expect(
      paymentMethodOf(order({ created_at: "x", metadata: { payment_method: "COD" } })),
    ).toBe("COD")
  })
})

describe("percentChange", () => {
  it("returns null against a zero baseline instead of a meaningless +100%", () => {
    expect(percentChange(500, 0)).toBeNull()
  })
  it("computes rise and fall", () => {
    expect(percentChange(150, 100)).toBe(50)
    expect(percentChange(50, 100)).toBe(-50)
  })
})

describe("buildDailySalesReport", () => {
  const DAY = "2026-08-13"

  const sample: OrderLike[] = [
    // On the reported day (MU).
    order({ created_at: "2026-08-13T06:00:00.000Z", total: 2000, metadata: { source: "dm_admin", payment_method: "COD" } }),
    order({ created_at: "2026-08-13T10:00:00.000Z", total: 1000, metadata: { payment_method: "Juice / Bank Transfer" } }),
    // 2026-08-13 23:00 MU — still the reported day.
    order({ created_at: "2026-08-13T19:00:00.000Z", total: 500, metadata: {} }),
    // Cancelled on the day — must not count.
    order({ created_at: "2026-08-13T08:00:00.000Z", total: 9999, status: "canceled" }),
    // 2026-08-14 MU — the next day, excluded.
    order({ created_at: "2026-08-13T21:00:00.000Z", total: 7777 }),
    // Day before.
    order({ created_at: "2026-08-12T06:00:00.000Z", total: 1500 }),
    // Same day last week.
    order({ created_at: "2026-08-06T06:00:00.000Z", total: 800 }),
  ]

  it("buckets by Mauritius day and excludes cancellations", () => {
    const r = buildDailySalesReport(sample, DAY)
    expect(r.today.orders).toBe(3)
    expect(r.today.revenueMur).toBe(3500)
    expect(r.previousDay.revenueMur).toBe(1500)
    expect(r.sameDayLastWeek.revenueMur).toBe(800)
  })

  it("computes average order value over countable orders only", () => {
    const r = buildDailySalesReport(sample, DAY)
    expect(r.today.averageOrderMur).toBe(Math.round(3500 / 3))
  })

  it("breaks down by channel and payment, sorted by revenue", () => {
    const r = buildDailySalesReport(sample, DAY)
    expect(r.byChannel).toEqual([
      { label: "DM", orders: 1, revenueMur: 2000 },
      { label: "WEB", orders: 2, revenueMur: 1500 },
    ])
    expect(r.byPaymentMethod[0]).toEqual({ label: "COD", orders: 1, revenueMur: 2000 })
  })

  it("reports zeros for a day with no orders", () => {
    const r = buildDailySalesReport([], DAY)
    expect(r.today).toEqual({ orders: 0, revenueMur: 0, averageOrderMur: 0 })
    expect(r.byChannel).toEqual([])
  })
})

describe("formatMur", () => {
  it("groups thousands", () => {
    expect(formatMur(2665)).toBe("Rs 2,665")
    expect(formatMur(1234567)).toBe("Rs 1,234,567")
  })
})

describe("buildDailySalesMessage", () => {
  const DAY = "2026-08-13"

  it("leads with revenue, order count and average", () => {
    const r = buildDailySalesReport(
      [
        order({ created_at: "2026-08-13T06:00:00.000Z", total: 2000 }),
        order({ created_at: "2026-08-13T07:00:00.000Z", total: 1000 }),
        order({ created_at: "2026-08-12T06:00:00.000Z", total: 1500 }),
      ],
      DAY,
    )
    const msg = buildDailySalesMessage(r)
    expect(msg).toContain("Doll Up — 2026-08-13")
    expect(msg).toContain("<b>Rs 3,000</b> from 2 orders")
    expect(msg).toContain("Average order Rs 1,500")
    // 3000 vs 1500 the day before = +100%
    expect(msg).toContain("Day before: Rs 1,500 ▲ 100%")
  })

  it("says 'no orders' for an empty comparison day instead of a fake percentage", () => {
    const r = buildDailySalesReport(
      [order({ created_at: "2026-08-13T06:00:00.000Z", total: 2000 })],
      DAY,
    )
    const msg = buildDailySalesMessage(r)
    expect(msg).toContain("Day before: no orders")
    expect(msg).toContain("Same day last week: no orders")
  })

  it("still reports on a zero-order day so silence never looks like a broken job", () => {
    const msg = buildDailySalesMessage(buildDailySalesReport([], DAY))
    expect(msg).toContain("<b>No orders.</b>")
  })

  it("escapes HTML in a point-of-sale label", () => {
    const r = buildDailySalesReport(
      [
        order({
          created_at: "2026-08-13T06:00:00.000Z",
          total: 100,
          metadata: { point_of_sale: "<b>hack</b>" },
        }),
      ],
      DAY,
    )
    const msg = buildDailySalesMessage(r)
    expect(msg).toContain("&lt;b&gt;hack&lt;/b&gt;")
    expect(msg).not.toContain("<b>hack</b>")
  })
})
