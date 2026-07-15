import { createHash } from "crypto"
import { bubbleId, buildPayload, DRAW_START, DRAW_END } from "../entries"

const order = (over: Partial<Parameters<typeof buildPayload>[0][number]> = {}) => ({
  id: "order_01",
  created_at: "2026-07-18T09:00:00Z",
  email: "rahvi@gmail.com",
  sales_channel: { id: "sc_web" },
  shipping_address: { first_name: "Rahvi", last_name: "Bichon" },
  ...over,
})

describe("bubbleId", () => {
  it("is the first 6 hex chars of sha256(order id)", () => {
    const expected = createHash("sha256").update("order_01").digest("hex").slice(0, 6)
    expect(bubbleId("order_01")).toBe(expected)
    expect(bubbleId("order_01")).toHaveLength(6)
  })

  it("is stable and differs per order", () => {
    expect(bubbleId("order_01")).toBe(bubbleId("order_01"))
    expect(bubbleId("order_01")).not.toBe(bubbleId("order_02"))
  })
})

describe("buildPayload", () => {
  it("marks website-channel orders as entries and others as plain", () => {
    const out = buildPayload(
      [
        order({ id: "order_01", sales_channel: { id: "sc_web" } }),
        order({ id: "order_02", sales_channel: { id: "sc_dm" } }),
      ],
      { channelId: "sc_web" },
    )
    expect(out.entries.map((e) => e.isEntry)).toEqual([true, false])
    expect(out.count).toBe(2)
    expect(out.entryCount).toBe(1)
  })

  it("treats orders with no sales channel as not-an-entry", () => {
    const out = buildPayload([order({ sales_channel: null })], { channelId: "sc_web" })
    expect(out.entries[0].isEntry).toBe(false)
    expect(out.entryCount).toBe(0)
  })

  it("marks nothing as an entry when no channel is configured", () => {
    const out = buildPayload([order()], { channelId: null })
    expect(out.entries[0].isEntry).toBe(false)
    expect(out.entryCount).toBe(0)
  })

  it("does not dedupe by customer — one bubble per order", () => {
    const out = buildPayload(
      [
        order({ id: "order_01" }),
        order({ id: "order_02" }),
        order({ id: "order_03" }),
      ],
      { channelId: "sc_web" },
    )
    expect(out.count).toBe(3)
    expect(out.entryCount).toBe(3)
    expect(out.entries.map((e) => e.name)).toEqual(["Rahvi B.", "Rahvi B.", "Rahvi B."])
  })

  it("sorts newest first", () => {
    const out = buildPayload(
      [
        order({ id: "a", created_at: "2026-07-18T08:00:00Z" }),
        order({ id: "b", created_at: "2026-07-20T08:00:00Z" }),
      ],
      { channelId: "sc_web" },
    )
    expect(out.entries.map((e) => e.id)).toEqual([bubbleId("b"), bubbleId("a")])
  })

  it("emits only id, name, isEntry and at — never PII", () => {
    const out = buildPayload([order()], { channelId: "sc_web" })
    expect(Object.keys(out.entries[0]).sort()).toEqual(["at", "id", "isEntry", "name"])
    const serialized = JSON.stringify(out)
    expect(serialized).not.toContain("rahvi@gmail.com")
    expect(serialized).not.toContain("Bichon")
    expect(serialized).not.toContain("order_01")
  })

  it("resolves the winner id by hashing the winning order id", () => {
    const out = buildPayload([order({ id: "order_07" })], {
      channelId: "sc_web",
      winnerOrderId: "order_07",
    })
    expect(out.winnerId).toBe(bubbleId("order_07"))
  })

  it("accepts an already-hashed winner id", () => {
    const hashed = bubbleId("order_07")
    const out = buildPayload([order({ id: "order_07" })], {
      channelId: "sc_web",
      winnerOrderId: hashed,
    })
    expect(out.winnerId).toBe(hashed)
  })

  it("has a null winner when unset", () => {
    expect(buildPayload([order()], { channelId: "sc_web" }).winnerId).toBeNull()
  })

  it("has a null winner when the winning order is not in the list", () => {
    const out = buildPayload([order({ id: "order_01" })], {
      channelId: "sc_web",
      winnerOrderId: "order_99",
    })
    expect(out.winnerId).toBeNull()
  })

  it("uses the draw window constants", () => {
    expect(DRAW_START.toISOString()).toBe("2026-07-16T20:00:00.000Z")
    expect(DRAW_END.toISOString()).toBe("2026-07-31T19:59:59.000Z")
  })
})
