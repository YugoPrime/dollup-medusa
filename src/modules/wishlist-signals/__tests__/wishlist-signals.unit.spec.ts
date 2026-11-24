import { GET } from "../../../api/admin/wishlist-counts/route"
import { POST } from "../../../api/store/wishlist-events/route"
import WishlistSignalsModuleService from "../service"
import { parseWishlistEvent } from "../validate"

const ANON = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b"
const P1 = "prod_01KN48PYHQ0DTXXN2N0JWZSAYV"
const P2 = "prod_01KN48PYHQ0DTXXN2N0JWZSAYW"
const CUS = "cus_01KN07JKHRN9DP25TM5S664C5W"

const proto = WishlistSignalsModuleService.prototype

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (s: number) => {
    res.statusCode = s
    return res
  }
  res.json = (b: unknown) => {
    res.body = b
    return res
  }
  return res
}

describe("parseWishlistEvent", () => {
  it("accepts an add from a guest browser, de-duplicating the ids", () => {
    expect(parseWishlistEvent({ anon_id: ANON, action: "add", product_ids: [P1, P1, P2] })).toEqual({
      event: { anonId: ANON, customerId: null, action: "add", productIds: [P1, P2] },
    })
  })

  it("keeps the signed-in customer's id when the browser is linked to one", () => {
    expect(
      parseWishlistEvent({ anon_id: ANON, customer_id: CUS, action: "remove", product_ids: [P1] }),
    ).toEqual({ event: { anonId: ANON, customerId: CUS, action: "remove", productIds: [P1] } })
  })

  it.each([
    ["no body", undefined],
    ["a browser id that isn't a UUID", { anon_id: "abc", action: "add", product_ids: [P1] }],
    ["an unknown action", { anon_id: ANON, action: "toggle", product_ids: [P1] }],
    ["no products", { anon_id: ANON, action: "add", product_ids: [] }],
    ["a non-product id", { anon_id: ANON, action: "add", product_ids: ["variant_01KN48PYHQ"] }],
    ["too many products", { anon_id: ANON, action: "add", product_ids: Array.from({ length: 201 }, (_, i) => `prod_${String(i).padStart(26, "0")}`) }],
    ["a bad customer id", { anon_id: ANON, customer_id: "someone@x.mu", action: "add", product_ids: [P1] }],
  ])("rejects %s", (_label, body) => {
    expect(parseWishlistEvent(body)).toHaveProperty("error")
  })
})

describe("WishlistSignalsModuleService.recordEvent", () => {
  it("adds only the hearts this browser hasn't sent before", async () => {
    const fake = {
      listWishlistSignals: jest.fn(async () => [{ id: "wsig_1", product_id: P1, customer_id: null }]),
      createWishlistSignals: jest.fn(async (d: unknown) => d),
      updateWishlistSignals: jest.fn(),
      deleteWishlistSignals: jest.fn(),
    }
    await proto.recordEvent.call(fake, { anonId: ANON, customerId: null, action: "add", productIds: [P1, P2] })
    expect(fake.listWishlistSignals).toHaveBeenCalledWith(
      { anon_id: ANON, product_id: [P1, P2] },
      { take: null },
    )
    expect(fake.createWishlistSignals).toHaveBeenCalledWith([
      { anon_id: ANON, product_id: P2, customer_id: null },
    ])
    expect(fake.updateWishlistSignals).not.toHaveBeenCalled()
  })

  it("puts the customer on a guest heart once the shopper signs in", async () => {
    const fake = {
      listWishlistSignals: jest.fn(async () => [{ id: "wsig_1", product_id: P1, customer_id: null }]),
      createWishlistSignals: jest.fn(),
      updateWishlistSignals: jest.fn(async (d: unknown) => d),
      deleteWishlistSignals: jest.fn(),
    }
    await proto.recordEvent.call(fake, { anonId: ANON, customerId: CUS, action: "add", productIds: [P1] })
    expect(fake.createWishlistSignals).not.toHaveBeenCalled()
    expect(fake.updateWishlistSignals).toHaveBeenCalledWith([{ id: "wsig_1", customer_id: CUS }])
  })

  it("deletes the hearts a shopper removes", async () => {
    const fake = {
      listWishlistSignals: jest.fn(async () => [{ id: "wsig_1", product_id: P1, customer_id: null }]),
      createWishlistSignals: jest.fn(),
      updateWishlistSignals: jest.fn(),
      deleteWishlistSignals: jest.fn(async () => undefined),
    }
    await proto.recordEvent.call(fake, { anonId: ANON, customerId: null, action: "remove", productIds: [P1, P2] })
    expect(fake.deleteWishlistSignals).toHaveBeenCalledWith(["wsig_1"])
  })
})

describe("WishlistSignalsModuleService.countsByProduct", () => {
  it("splits guests from signed-in customers, counting a customer on two devices once", async () => {
    const fake = {
      listWishlistSignals: jest.fn(async () => [
        { anon_id: "a", product_id: P1, customer_id: null },
        { anon_id: "b", product_id: P1, customer_id: CUS },
        { anon_id: "c", product_id: P1, customer_id: CUS },
        { anon_id: "a", product_id: P2, customer_id: null },
      ]),
    }
    expect(await proto.countsByProduct.call(fake)).toEqual({
      counts: [
        { product_id: P1, guests: 1, customer_ids: [CUS] },
        { product_id: P2, guests: 1, customer_ids: [] },
      ],
      browsers: 3,
    })
    expect(fake.listWishlistSignals).toHaveBeenCalledWith(
      {},
      { select: ["anon_id", "product_id", "customer_id"], take: null },
    )
  })
})

describe("POST /store/wishlist-events", () => {
  it("answers 400 and writes nothing for a bad body", async () => {
    const recordEvent = jest.fn()
    const res = fakeRes()
    await POST({ body: { anon_id: "x" }, scope: { resolve: () => ({ recordEvent }) } } as any, res)
    expect(res.statusCode).toBe(400)
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it("records a valid event", async () => {
    const recordEvent = jest.fn(async () => undefined)
    const res = fakeRes()
    await POST(
      {
        body: { anon_id: ANON, action: "add", product_ids: [P1] },
        scope: { resolve: () => ({ recordEvent }) },
      } as any,
      res,
    )
    expect(recordEvent).toHaveBeenCalledWith({ anonId: ANON, customerId: null, action: "add", productIds: [P1] })
    expect(res.body).toEqual({ ok: true })
  })
})

describe("GET /admin/wishlist-counts", () => {
  it("returns the counts", async () => {
    const out = { counts: [], browsers: 0 }
    const res = fakeRes()
    await GET({ scope: { resolve: () => ({ countsByProduct: async () => out }) } } as any, res)
    expect(res.body).toEqual(out)
  })
})
