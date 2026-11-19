import { loyaltyMultiplier, muYmd } from "../loyalty-multiplier"

describe("loyaltyMultiplier", () => {
  const web = { cart_type: "instock" }
  it.each([
    ["2026-12-06T19:59:59Z", web, 1],
    ["2026-12-06T20:00:00Z", web, 2],
    ["2026-12-07T19:59:59Z", web, 2],
    ["2026-12-07T20:00:00Z", web, 1],
    ["2026-12-14T08:00:00Z", web, 2],
    ["2026-12-21T08:00:00Z", web, 2],
    ["2026-12-07T08:00:00Z", { cart_type: "preorder" }, 1],
    ["2026-12-07T08:00:00Z", { dm_status: "confirmed" }, 1],
    ["2026-12-07T08:00:00Z", null, 1],
    ["2026-12-07T08:00:00Z", { cart_type: null }, 2],
    ["2026-12-07T08:00:00Z", {}, 1],
  ])("%s %j -> %d", (at, metadata, expected) => {
    expect(loyaltyMultiplier({ created_at: at, metadata })).toBe(expected)
    expect(loyaltyMultiplier({ created_at: new Date(at), metadata })).toBe(expected)
  })
  it("no created_at -> 1", () => expect(loyaltyMultiplier({ metadata: web })).toBe(1))
  it("muYmd at MU midnight", () => expect(muYmd("2026-12-06T20:00:00Z")).toBe("2026-12-07"))
})
