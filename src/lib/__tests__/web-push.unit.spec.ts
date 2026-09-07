jest.mock("web-push", () => ({
  __esModule: true,
  default: { setVapidDetails: jest.fn(), sendNotification: jest.fn() },
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}))

import webpush from "web-push"
import {
  buildOrderPlacedPayload,
  getAdminUrl,
  isWebPushConfigured,
  sendWebPush,
} from "../web-push"

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
const env = {
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
  VAPID_SUBJECT: "mailto:hello@influxe.agency",
} as NodeJS.ProcessEnv
const target = { endpoint: "https://push.example/abc", p256dh: "k", auth: "a" }
const payload = { title: "t", body: "b", url: "https://admin.dollupboutique.com/orders/1", tag: "order-1" }

describe("isWebPushConfigured", () => {
  it("is true only when all three VAPID vars are set", () => {
    expect(isWebPushConfigured(env)).toBe(true)
    expect(isWebPushConfigured({ ...env, VAPID_PRIVATE_KEY: "" })).toBe(false)
    expect(isWebPushConfigured({} as NodeJS.ProcessEnv)).toBe(false)
  })
})

describe("getAdminUrl", () => {
  it("defaults to the admin app and strips a trailing slash", () => {
    expect(getAdminUrl({} as NodeJS.ProcessEnv)).toBe("https://admin.dollupboutique.com")
    expect(getAdminUrl({ ADMIN_URL: "https://x.test/" } as NodeJS.ProcessEnv)).toBe("https://x.test")
  })
})

describe("sendWebPush", () => {
  beforeEach(() => jest.clearAllMocks())

  it("sends the JSON payload to the endpoint with the stored keys", async () => {
    ;(webpush.sendNotification as jest.Mock).mockResolvedValue({ statusCode: 201 })
    const res = await sendWebPush(logger, target, payload, env)
    expect(res).toEqual({ ok: true })
    expect(webpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: target.endpoint, keys: { p256dh: "k", auth: "a" } },
      JSON.stringify(payload),
      expect.objectContaining({ TTL: expect.any(Number) }),
    )
  })

  it("flags 410 and 404 as gone", async () => {
    ;(webpush.sendNotification as jest.Mock).mockRejectedValueOnce({ statusCode: 410, body: "gone" })
    expect(await sendWebPush(logger, target, payload, env)).toMatchObject({ ok: false, gone: true, status: 410 })
    ;(webpush.sendNotification as jest.Mock).mockRejectedValueOnce({ statusCode: 404, body: "" })
    expect(await sendWebPush(logger, target, payload, env)).toMatchObject({ ok: false, gone: true, status: 404 })
  })

  it("keeps the subscription on other failures", async () => {
    ;(webpush.sendNotification as jest.Mock).mockRejectedValueOnce(new Error("boom"))
    expect(await sendWebPush(logger, target, payload, env)).toMatchObject({ ok: false, gone: false, message: "boom" })
  })

  it("surfaces the provider's response body over web-push's generic message", async () => {
    ;(webpush.sendNotification as jest.Mock).mockRejectedValueOnce({
      statusCode: 400,
      body: "InvalidRegistration",
      message: "Received unexpected response code",
    })
    expect(await sendWebPush(logger, target, payload, env)).toMatchObject({
      ok: false,
      gone: false,
      message: "InvalidRegistration (HTTP 400)",
    })
  })

  it("returns not-configured without calling the push service", async () => {
    const res = await sendWebPush(logger, target, payload, {} as NodeJS.ProcessEnv)
    expect(res).toMatchObject({ ok: false, gone: false })
    expect(webpush.sendNotification).not.toHaveBeenCalled()
  })
})

describe("buildOrderPlacedPayload", () => {
  const admin = "https://admin.dollupboutique.com"
  const base = {
    id: "order_1",
    display_id: 123,
    email: "jane@x.mu",
    subtotal: 1400,
    shipping_total: 50,
    total: 1450,
    metadata: { delivery_method: "home delivery" },
    items: [{ quantity: 2 }, { quantity: 1 }],
    shipping_address: { first_name: "Jane", last_name: "Doe" },
  }

  it("formats a normal order", () => {
    expect(buildOrderPlacedPayload(base, admin)).toEqual({
      title: "New order #123 · Rs 1,450",
      body: "Jane Doe · 3 items · Home delivery",
      url: `${admin}/orders/order_1`,
      tag: "order-order_1",
    })
  })

  it("formats a pre-order with the deposit", () => {
    const pre = { ...base, metadata: { cart_type: "preorder", deposit_amount: 1088, delivery_method: "pickup" } }
    expect(buildOrderPlacedPayload(pre, admin).title).toBe("New pre-order #123 · deposit Rs 1,088")
    expect(buildOrderPlacedPayload(pre, admin).body).toBe("Jane Doe · 3 items · Pickup")
  })

  it("computes the deposit when the stamp has not landed yet", () => {
    const pre = { ...base, metadata: { cart_type: "preorder" } }
    // computeDeposit(1400, 50): 75% of subtotal + shipping = 1050 + 50 = 1100
    expect(buildOrderPlacedPayload(pre, admin).title).toMatch(/^New pre-order #123 · deposit Rs [\d,]+$/)
  })

  it("falls back to email then Guest, and singular item", () => {
    const guest = { ...base, shipping_address: null, email: null, items: [{ quantity: 1 }], metadata: {} }
    expect(buildOrderPlacedPayload(guest, admin).body).toBe("Guest · 1 item")
    expect(buildOrderPlacedPayload({ ...guest, email: "g@x.mu" }, admin).body).toBe("g@x.mu · 1 item")
  })

  it("reads Medusa BigNumber-shaped totals", () => {
    const bn = { ...base, total: { value: "1450" } }
    expect(buildOrderPlacedPayload(bn, admin).title).toBe("New order #123 · Rs 1,450")
  })

  // The real thing retrieveOrder hands back: a BigNumber instance whose amount
  // is only reachable through valueOf()/numeric. Reading `.value` off it gives
  // undefined → Rs 0, which is exactly what shipped to the phone as
  // "New order #982 · Rs 0".
  it("reads a real BigNumber instance (valueOf/numeric, no top-level value)", () => {
    class FakeBigNumber {
      raw_: { value: string; precision: number }
      numeric_: number
      constructor(n: number) {
        this.raw_ = { value: String(n), precision: 20 }
        this.numeric_ = n
      }
      get numeric() {
        return this.numeric_
      }
      valueOf() {
        return this.numeric_
      }
      toJSON() {
        return this.numeric_
      }
    }
    const bn = {
      ...base,
      subtotal: new FakeBigNumber(1400),
      shipping_total: new FakeBigNumber(50),
      total: new FakeBigNumber(1450),
    }
    expect(buildOrderPlacedPayload(bn, admin).title).toBe("New order #123 · Rs 1,450")

    const pre = { ...bn, metadata: { cart_type: "preorder" } }
    // 75% of 1400 + 50 shipping = 1,100 — not "deposit Rs 0".
    expect(buildOrderPlacedPayload(pre, admin).title).toBe(
      "New pre-order #123 · deposit Rs 1,100",
    )
  })
})
