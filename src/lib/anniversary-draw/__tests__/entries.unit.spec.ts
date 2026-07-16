import { createHash } from "crypto"
import { bubbleId, buildPayload, DRAW_START, DRAW_END } from "../entries"

const order = (over: Partial<Parameters<typeof buildPayload>[0][number]> = {}) => ({
  id: "order_01",
  created_at: "2026-07-18T09:00:00Z",
  email: "rahvi@gmail.com",
  metadata: { cart_type: "instock" },
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
  describe("eligibility: metadata.cart_type key presence", () => {
    it("marks an order with metadata.cart_type: 'instock' as an entry", () => {
      const out = buildPayload([order({ metadata: { cart_type: "instock" } })], {})
      expect(out.entries[0].isEntry).toBe(true)
      expect(out.entryCount).toBe(1)
    })

    it("marks an order with metadata.cart_type: null as an entry — the real July edge case " +
      "where the storefront cart provider clears cart_type's value on an emptied-then-refilled " +
      "cart, but the key itself stays present. Key presence, not truthiness, must be eligible.", () => {
      const out = buildPayload([order({ metadata: { cart_type: null } })], {})
      expect(out.entries[0].isEntry).toBe(true)
      expect(out.entryCount).toBe(1)
    })

    it("marks a DM/manual order (no cart_type key at all) as not-an-entry", () => {
      const out = buildPayload([order({ metadata: { source: "dm_admin" } })], {})
      expect(out.entries[0].isEntry).toBe(false)
      expect(out.entryCount).toBe(0)
    })

    it("marks a hermes-sourced manual order (no cart_type key) as not-an-entry", () => {
      const out = buildPayload([order({ metadata: { source: "hermes" } })], {})
      expect(out.entries[0].isEntry).toBe(false)
      expect(out.entryCount).toBe(0)
    })

    it("fails closed when metadata is null", () => {
      const out = buildPayload([order({ metadata: null })], {})
      expect(out.entries[0].isEntry).toBe(false)
      expect(out.entryCount).toBe(0)
    })

    it("fails closed when metadata is undefined", () => {
      const out = buildPayload([order({ metadata: undefined })], {})
      expect(out.entries[0].isEntry).toBe(false)
      expect(out.entryCount).toBe(0)
    })

    it("fails closed when metadata is an empty object", () => {
      const out = buildPayload([order({ metadata: {} })], {})
      expect(out.entries[0].isEntry).toBe(false)
      expect(out.entryCount).toBe(0)
    })

    it("mixes website and DM orders correctly in the same batch", () => {
      const out = buildPayload(
        [
          order({ id: "order_01", metadata: { cart_type: "instock" } }),
          order({ id: "order_02", metadata: { source: "dm_admin" } }),
        ],
        {},
      )
      expect(out.entries.map((e) => e.isEntry)).toEqual([true, false])
      expect(out.count).toBe(2)
      expect(out.entryCount).toBe(1)
    })
  })

  it("does not dedupe by customer — one bubble per order", () => {
    const out = buildPayload(
      [
        order({ id: "order_01" }),
        order({ id: "order_02" }),
        order({ id: "order_03" }),
      ],
      {},
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
      {},
    )
    expect(out.entries.map((e) => e.id)).toEqual([bubbleId("b"), bubbleId("a")])
  })

  it("emits only id, name, isEntry and at — never PII (including metadata contents)", () => {
    const out = buildPayload(
      [
        order({
          email: "rahvi@gmail.com",
          metadata: { cart_type: "instock", phone: "+230 5555 1234", notes: "call before delivery" },
        }),
      ],
      {},
    )
    expect(Object.keys(out.entries[0]).sort()).toEqual(["at", "id", "isEntry", "name"])
    const serialized = JSON.stringify(out)
    expect(serialized).not.toContain("rahvi@gmail.com")
    expect(serialized).not.toContain("Bichon")
    expect(serialized).not.toContain("order_01")
    expect(serialized).not.toContain("+230 5555 1234")
    expect(serialized).not.toContain("call before delivery")
  })

  describe("winner resolution", () => {
    it("resolves the winner id by hashing the winning order id, when it is an eligible entry", () => {
      const out = buildPayload(
        [order({ id: "order_07", metadata: { cart_type: "instock" } })],
        { winnerOrderId: "order_07" },
      )
      expect(out.winnerId).toBe(bubbleId("order_07"))
    })

    it("accepts an already-hashed winner id, when it is an eligible entry", () => {
      const hashed = bubbleId("order_07")
      const out = buildPayload(
        [order({ id: "order_07", metadata: { cart_type: "instock" } })],
        { winnerOrderId: hashed },
      )
      expect(out.winnerId).toBe(hashed)
    })

    it("has a null winner when unset", () => {
      expect(buildPayload([order()], {}).winnerId).toBeNull()
    })

    it("has a null winner when the winning order is not in the list", () => {
      const out = buildPayload([order({ id: "order_01" })], { winnerOrderId: "order_99" })
      expect(out.winnerId).toBeNull()
    })

    it("does not resolve a winner pointing at a non-eligible (DM/manual) order, and warns", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
      const out = buildPayload(
        [order({ id: "order_08", metadata: { source: "dm_admin" } })],
        { winnerOrderId: "order_08" },
      )
      expect(out.winnerId).toBeNull()
      expect(warnSpy).toHaveBeenCalled()
      expect(warnSpy.mock.calls[0][0]).toContain("order_08")
      warnSpy.mockRestore()
    })

    it("warns when winnerOrderId is truthy but resolves to nothing at all", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
      const out = buildPayload([order({ id: "order_01" })], { winnerOrderId: "order_typo" })
      expect(out.winnerId).toBeNull()
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  it("uses the draw window constants", () => {
    expect(DRAW_START.toISOString()).toBe("2026-07-16T20:00:00.000Z")
    expect(DRAW_END.toISOString()).toBe("2026-07-31T19:59:59.000Z")
  })
})
