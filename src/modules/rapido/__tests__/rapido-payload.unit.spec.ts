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
})
