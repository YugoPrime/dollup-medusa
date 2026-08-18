import { isDeliveredStatus, deliveredStatusSet } from "../delivered-status"

describe("isDeliveredStatus", () => {
  it("matches the canonical DELIVERED status", () => {
    expect(isDeliveredStatus("DELIVERED")).toBe(true)
  })

  it("is case-insensitive", () => {
    expect(isDeliveredStatus("delivered")).toBe(true)
    expect(isDeliveredStatus("Delivered")).toBe(true)
  })

  it("tolerates surrounding whitespace", () => {
    expect(isDeliveredStatus("  DELIVERED \n")).toBe(true)
  })

  it("normalises separators so spaces and hyphens read as underscores", () => {
    expect(isDeliveredStatus("order delivered")).toBe(false) // not in the set
    expect(isDeliveredStatus("ORDER-COMPLETED")).toBe(false) // not in the set
  })

  it("accepts the other default terminal statuses", () => {
    expect(isDeliveredStatus("COMPLETED")).toBe(true)
    expect(isDeliveredStatus("LIVRE")).toBe(true)
    expect(isDeliveredStatus("LIVREE")).toBe(true)
  })

  it("strips accents so the French forms match as typed", () => {
    expect(isDeliveredStatus("livré")).toBe(true)
    expect(isDeliveredStatus("Livrée")).toBe(true)
  })

  it("rejects in-flight statuses", () => {
    expect(isDeliveredStatus("READY_FOR_PICKUP")).toBe(false)
    expect(isDeliveredStatus("PICKED_UP")).toBe(false)
    expect(isDeliveredStatus("IN_TRANSIT")).toBe(false)
  })

  it("rejects failure statuses — a failed delivery must never mark an order delivered", () => {
    expect(isDeliveredStatus("FAILED")).toBe(false)
    expect(isDeliveredStatus("RETURNED")).toBe(false)
    expect(isDeliveredStatus("CANCELLED")).toBe(false)
    expect(isDeliveredStatus("DELIVERY_FAILED")).toBe(false)
    expect(isDeliveredStatus("NOT_DELIVERED")).toBe(false)
  })

  it("rejects empty and non-string input", () => {
    expect(isDeliveredStatus("")).toBe(false)
    expect(isDeliveredStatus("   ")).toBe(false)
    expect(isDeliveredStatus(undefined as unknown as string)).toBe(false)
    expect(isDeliveredStatus(null as unknown as string)).toBe(false)
  })
})

describe("deliveredStatusSet", () => {
  const original = process.env.RAPIDO_DELIVERED_STATUSES

  afterEach(() => {
    if (original === undefined) delete process.env.RAPIDO_DELIVERED_STATUSES
    else process.env.RAPIDO_DELIVERED_STATUSES = original
  })

  it("falls back to the defaults when the env var is unset", () => {
    delete process.env.RAPIDO_DELIVERED_STATUSES
    expect(deliveredStatusSet().has("DELIVERED")).toBe(true)
  })

  it("falls back to the defaults when the env var is blank", () => {
    process.env.RAPIDO_DELIVERED_STATUSES = "   "
    expect(deliveredStatusSet().has("DELIVERED")).toBe(true)
  })

  it("replaces the defaults when the env var is set", () => {
    process.env.RAPIDO_DELIVERED_STATUSES = "ORDER_DELIVERED,DROPPED_OFF"
    expect(isDeliveredStatus("order delivered")).toBe(true)
    expect(isDeliveredStatus("DROPPED-OFF")).toBe(true)
    // The defaults are gone — the env var is an override, not an addition.
    expect(isDeliveredStatus("DELIVERED")).toBe(false)
  })

  it("ignores empty entries and whitespace in the env var", () => {
    process.env.RAPIDO_DELIVERED_STATUSES = " DELIVERED , , DONE ,"
    expect(deliveredStatusSet()).toEqual(new Set(["DELIVERED", "DONE"]))
  })

  it("is read at call time, not module load, so Coolify env edits take effect on restart", () => {
    process.env.RAPIDO_DELIVERED_STATUSES = "ALPHA"
    expect(isDeliveredStatus("ALPHA")).toBe(true)
    process.env.RAPIDO_DELIVERED_STATUSES = "BETA"
    expect(isDeliveredStatus("ALPHA")).toBe(false)
    expect(isDeliveredStatus("BETA")).toBe(true)
  })
})
