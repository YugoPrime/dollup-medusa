import { validateRapidoPayload, type RapidoOrderPayload } from "../rapido-payload"

const valid: RapidoOrderPayload = {
  recipientName: "Jane Doe",
  recipientPhone: "58123456",
  deliveryAddress: "12 Royal Road",
  zone: "Quatre Bornes",
  parcelCount: 1,
  codAmount: 1500,
  deliveryFeeBearer: "merchant",
  externalOrderRef: "order_123",
  items: [{ productName: "Lip gloss", unitPrice: 350, quantity: 2 }],
}

describe("validateRapidoPayload", () => {
  it("accepts a well-formed payload", () => {
    expect(validateRapidoPayload(valid).ok).toBe(true)
  })
  it("rejects a phone that is not 8 digits", () => {
    expect(validateRapidoPayload({ ...valid, recipientPhone: "5812345" })).toEqual({
      ok: false,
      error: "recipientPhone must be 8 digits",
    })
  })
  it("rejects an empty zone", () => {
    expect(validateRapidoPayload({ ...valid, zone: "  " })).toEqual({
      ok: false,
      error: "zone is required",
    })
  })
  it("rejects a negative codAmount", () => {
    expect(validateRapidoPayload({ ...valid, codAmount: -5 })).toEqual({
      ok: false,
      error: "codAmount must be >= 0",
    })
  })
  it("rejects a non-object", () => {
    expect(validateRapidoPayload(null)).toEqual({
      ok: false,
      error: "payload must be an object",
    })
  })
  it("rejects a zero parcelCount", () => {
    expect(validateRapidoPayload({ ...valid, parcelCount: 0 })).toEqual({
      ok: false,
      error: "parcelCount must be a positive integer",
    })
  })
  it("rejects a non-numeric parcelCount", () => {
    expect(validateRapidoPayload({ ...valid, parcelCount: "1" })).toEqual({
      ok: false,
      error: "parcelCount must be a positive integer",
    })
  })
  it("rejects an item missing productName", () => {
    expect(validateRapidoPayload({ ...valid, items: [{ unitPrice: 350, quantity: 2 }] })).toEqual({
      ok: false,
      error: "each item needs a productName",
    })
  })
  it("rejects an item with negative unitPrice", () => {
    expect(validateRapidoPayload({ ...valid, items: [{ productName: "Lip gloss", unitPrice: -10, quantity: 2 }] })).toEqual({
      ok: false,
      error: "each item needs a unitPrice >= 0",
    })
  })
  it("rejects an item with quantity 0", () => {
    expect(validateRapidoPayload({ ...valid, items: [{ productName: "Lip gloss", unitPrice: 350, quantity: 0 }] })).toEqual({
      ok: false,
      error: "each item needs a quantity >= 1",
    })
  })
})
