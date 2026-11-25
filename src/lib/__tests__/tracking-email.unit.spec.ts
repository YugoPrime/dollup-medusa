import {
  isRealCustomerEmail,
  normalizeTrackingNumber,
  trackingEmailDecision,
} from "../tracking-email"

describe("tracking email decision", () => {
  const shippedWebsitePostage = {
    email: "customer@gmail.com",
    metadata: {
      delivery_method: "Postage",
      shipped_at: "2026-11-26T08:00:00.000Z",
      tracking_number: "DP207137471MU",
    },
  }

  it("sends for a shipped website postage order with a new number", () => {
    expect(trackingEmailDecision(shippedWebsitePostage)).toEqual({
      send: true,
      number: "DP207137471MU",
    })
  })

  it("covers Express and Rodrigues postage", () => {
    for (const method of ["Express Postage", "Rodrigues Postage"]) {
      expect(
        trackingEmailDecision({
          ...shippedWebsitePostage,
          metadata: { ...shippedWebsitePostage.metadata, delivery_method: method },
        }).send,
      ).toBe(true)
    }
  })

  it("sends once per number", () => {
    expect(
      trackingEmailDecision({
        ...shippedWebsitePostage,
        metadata: {
          ...shippedWebsitePostage.metadata,
          tracking_emailed: "dp207137471mu",
        },
      }),
    ).toEqual({ send: false, reason: "already_sent" })
  })

  it("sends again when staff correct the number", () => {
    expect(
      trackingEmailDecision({
        ...shippedWebsitePostage,
        metadata: {
          ...shippedWebsitePostage.metadata,
          tracking_emailed: "DP207137470MU",
        },
      }),
    ).toEqual({ send: true, number: "DP207137471MU" })
  })

  it("waits for the shipped email, which carries the number itself", () => {
    const { shipped_at: _unused, ...notShipped } = shippedWebsitePostage.metadata
    expect(
      trackingEmailDecision({ ...shippedWebsitePostage, metadata: notShipped }),
    ).toEqual({ send: false, reason: "not_shipped" })
  })

  it("skips DM orders (placeholder .local address) and missing emails", () => {
    expect(
      trackingEmailDecision({
        ...shippedWebsitePostage,
        email: "dm-4821@dollupboutique.local",
      }),
    ).toEqual({ send: false, reason: "no_email" })
    expect(
      trackingEmailDecision({ ...shippedWebsitePostage, email: null }),
    ).toEqual({ send: false, reason: "no_email" })
  })

  it("skips home delivery, pickup and orders without a number", () => {
    expect(
      trackingEmailDecision({
        ...shippedWebsitePostage,
        metadata: { ...shippedWebsitePostage.metadata, delivery_method: "Home Delivery" },
      }),
    ).toEqual({ send: false, reason: "not_postage" })
    expect(
      trackingEmailDecision({
        ...shippedWebsitePostage,
        metadata: { ...shippedWebsitePostage.metadata, tracking_number: "  " },
      }),
    ).toEqual({ send: false, reason: "no_number" })
  })

  it("cleans numbers and recognises real inboxes", () => {
    expect(normalizeTrackingNumber(" dp 207137471 mu ")).toBe("DP207137471MU")
    expect(normalizeTrackingNumber("")).toBeNull()
    expect(normalizeTrackingNumber(42)).toBeNull()
    expect(isRealCustomerEmail("someone@hotmail.fr")).toBe(true)
    expect(isRealCustomerEmail("someone@orders.dollupboutique.com")).toBe(false)
    expect(isRealCustomerEmail("hello@dollupboutique.com")).toBe(false)
    expect(isRealCustomerEmail("someone@DOLLUPBOUTIQUE.LOCAL")).toBe(false)
    expect(isRealCustomerEmail("not-an-email")).toBe(false)
  })
})
