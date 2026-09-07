import {
  buildPostagePrepMessage,
  selectPostagePrep,
  type PostageOrderLike,
} from "../postage-prep-reminder"

const TODAY = "2026-09-07"

let seq = 0
const order = (
  meta: Record<string, unknown>,
  over: Partial<PostageOrderLike> = {},
): PostageOrderLike => {
  seq++
  return {
    id: `order_${seq}`,
    display_id: 1000 + seq,
    status: "pending",
    fulfillment_status: "not_fulfilled",
    shipping_address: { first_name: "Ana", last_name: "R" },
    metadata: { delivery_method: "Postage", delivery_date: TODAY, ...meta },
    ...over,
  }
}

describe("selectPostagePrep", () => {
  it("includes a postage order still in preparation and due today", () => {
    const rows = selectPostagePrep([order({})], TODAY)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      orderNumber: "#1001",
      deliveryMethod: "Postage",
      customer: "Ana R",
      daysLate: 0,
    })
  })

  it("drops the order once dm_status flips to ready", () => {
    expect(selectPostagePrep([order({ dm_status: "ready" })], TODAY)).toEqual([])
  })

  it("keeps an order whose dm_status is explicitly preparation", () => {
    expect(
      selectPostagePrep([order({ dm_status: "preparation" })], TODAY),
    ).toHaveLength(1)
  })

  it("excludes cancelled orders", () => {
    expect(
      selectPostagePrep([order({}, { status: "canceled" })], TODAY),
    ).toEqual([])
  })

  it.each([
    "fulfilled",
    "partially_fulfilled",
    "shipped",
    "partially_shipped",
    "delivered",
    "partially_delivered",
  ])("excludes orders whose fulfillment status is %s", (fulfillment_status) => {
    expect(
      selectPostagePrep([order({}, { fulfillment_status })], TODAY),
    ).toEqual([])
  })

  it("excludes manual orders flagged delivered via metadata", () => {
    expect(selectPostagePrep([order({ dm_delivered: true })], TODAY)).toEqual([])
  })

  it("excludes an order that was replaced by a newer one", () => {
    expect(
      selectPostagePrep([order({ replaced_by_order_id: "order_x" })], TODAY),
    ).toEqual([])
  })

  it.each(["Home Delivery", "My Delivery", "Pick Up"])(
    "excludes the %s delivery method",
    (delivery_method) => {
      expect(
        selectPostagePrep([order({ delivery_method })], TODAY),
      ).toEqual([])
    },
  )

  it.each(["Postage", "Express Postage", "Rodrigues Postage"])(
    "includes the %s delivery method",
    (delivery_method) => {
      const rows = selectPostagePrep([order({ delivery_method })], TODAY)
      expect(rows).toHaveLength(1)
      expect(rows[0].deliveryMethod).toBe(delivery_method)
    },
  )

  it("excludes orders with no delivery method at all", () => {
    expect(
      selectPostagePrep([order({ delivery_method: undefined })], TODAY),
    ).toEqual([])
  })

  it("excludes postage orders dated in the future", () => {
    expect(
      selectPostagePrep([order({ delivery_date: "2026-09-08" })], TODAY),
    ).toEqual([])
  })

  it("includes a postage order with no delivery date", () => {
    const rows = selectPostagePrep(
      [order({ delivery_date: undefined })],
      TODAY,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].daysLate).toBe(0)
  })

  it("counts whole days late for an overdue order", () => {
    const rows = selectPostagePrep(
      [order({ delivery_date: "2026-09-02" })],
      TODAY,
    )
    expect(rows[0].daysLate).toBe(5)
  })

  it("sorts most overdue first, then by order number", () => {
    const rows = selectPostagePrep(
      [
        order({ delivery_date: TODAY }),
        order({ delivery_date: "2026-09-02" }),
        order({ delivery_date: "2026-09-05" }),
      ],
      TODAY,
    )
    expect(rows.map((r) => r.daysLate)).toEqual([5, 2, 0])
  })

  it("falls back to the order id when there is no display id", () => {
    const rows = selectPostagePrep(
      [order({}, { display_id: null, id: "order_abc" })],
      TODAY,
    )
    expect(rows[0].orderNumber).toBe("#order_abc")
  })

  it("tolerates a missing shipping address", () => {
    const rows = selectPostagePrep(
      [order({}, { shipping_address: null })],
      TODAY,
    )
    expect(rows[0].customer).toBe("")
  })
})

describe("buildPostagePrepMessage", () => {
  const entry = (over: Partial<ReturnType<typeof selectPostagePrep>[number]>) => ({
    orderNumber: "#1001",
    deliveryMethod: "Postage",
    customer: "Ana R",
    deliveryDate: TODAY,
    daysLate: 0,
    ...over,
  })

  it("stays silent when nothing is pending", () => {
    expect(buildPostagePrepMessage([])).toBeNull()
  })

  it("lists due-today orders under a due heading", () => {
    const msg = buildPostagePrepMessage([entry({})])!
    expect(msg).toContain("1 order")
    expect(msg).toContain("Due today")
    expect(msg).toContain("#1001 · Postage · Ana R")
    expect(msg).not.toContain("Overdue")
  })

  it("puts overdue orders in their own section with a day count", () => {
    const msg = buildPostagePrepMessage([
      entry({ orderNumber: "#1002", daysLate: 3 }),
      entry({}),
    ])!
    expect(msg).toContain("2 orders")
    expect(msg).toContain("Overdue")
    expect(msg).toContain("#1002 · Postage · Ana R · 3 days late")
    expect(msg).toContain("Due today")
  })

  it("says day, not days, for a single day late", () => {
    const msg = buildPostagePrepMessage([entry({ daysLate: 1 })])!
    expect(msg).toContain("1 day late")
    expect(msg).not.toContain("1 days late")
  })

  it("links to the prep page so the status can be flipped", () => {
    const msg = buildPostagePrepMessage([entry({})])!
    expect(msg).toContain("admin.dollupboutique.com/prep")
  })

  it("caps the list and reports how many were left out", () => {
    const entries = Array.from({ length: 25 }, (_, i) =>
      entry({ orderNumber: `#${1000 + i}` }),
    )
    const msg = buildPostagePrepMessage(entries)!
    expect(msg).toContain("25 orders")
    expect(msg).toContain("#1019")
    expect(msg).not.toContain("#1020")
    expect(msg).toContain("5 more")
  })

  it("escapes HTML in customer names so the message never breaks", () => {
    const msg = buildPostagePrepMessage([entry({ customer: "A <b>&" })])!
    expect(msg).toContain("A &lt;b&gt;&amp;")
  })
})
