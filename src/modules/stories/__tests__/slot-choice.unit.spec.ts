import { DEFAULT_WEIGHTING } from "../picker-weighting"
import type { ProductLike } from "../snapshot"
import { chooseSlotProduct } from "../slot-choice"

const NOW = Date.parse("2026-11-03T12:00:00Z")

function make(id: string, opts: { tags?: string[]; qty?: number } = {}): ProductLike {
  return {
    id,
    title: id,
    handle: id,
    created_at: "2026-01-01T00:00:00Z",
    tags: opts.tags ?? [],
    variants: [
      {
        id: `${id}_v`,
        inventory_quantity: opts.qty ?? 3,
        prices: [{ amount: 100000, currency_code: "mur" }],
        options: { color: "Red", size: "M" },
      },
    ],
  }
}

const F = ["collection30"]
const old1 = make("old1")
const focus1 = make("focus1", { tags: F })
const focus2 = make("focus2", { tags: F })
const focusSoldOut = make("focusSoldOut", { tags: F, qty: 0 })

describe("chooseSlotProduct", () => {
  it("picks a focus piece over older stock in the slot's category", async () => {
    const r = await chooseSlotProduct({
      inCategory: [old1, focus1],
      union: async () => [],
      excluded: new Set(),
      gridExcluded: new Set(),
      focusTag: "collection30",
      weighting: DEFAULT_WEIGHTING,
      now: NOW,
      rng: () => 0.99,
    })
    expect(r.product?.id).toBe("focus1")
    expect(r.fallbackUsed).toBe(false)
  })

  it("falls back to older stock when every focus piece is excluded or sold out", async () => {
    const r = await chooseSlotProduct({
      inCategory: [old1, focusSoldOut, focus1],
      union: async () => [],
      excluded: new Set(["focus1"]),
      gridExcluded: new Set(),
      focusTag: "collection30",
      weighting: DEFAULT_WEIGHTING,
      now: NOW,
    })
    expect(r.product?.id).toBe("old1")
  })

  it("never picks the day's grid product", async () => {
    const r = await chooseSlotProduct({
      inCategory: [focus1],
      union: async () => [focus2],
      excluded: new Set(),
      gridExcluded: new Set(["focus1"]),
      focusTag: "collection30",
      weighting: DEFAULT_WEIGHTING,
      now: NOW,
    })
    expect(r.product?.id).toBe("focus2")
    expect(r.fallbackUsed).toBe(true)
  })

  it("with no focus tag behaves like the weighted pick", async () => {
    const r = await chooseSlotProduct({
      inCategory: [old1],
      union: async () => [],
      excluded: new Set(),
      gridExcluded: new Set(),
      focusTag: null,
      weighting: DEFAULT_WEIGHTING,
      now: NOW,
    })
    expect(r.product?.id).toBe("old1")
  })

  it("returns no product when nothing is eligible anywhere", async () => {
    const r = await chooseSlotProduct({
      inCategory: [focusSoldOut],
      union: async () => [focusSoldOut],
      excluded: new Set(),
      gridExcluded: new Set(),
      focusTag: "collection30",
      weighting: DEFAULT_WEIGHTING,
      now: NOW,
    })
    expect(r.product).toBeNull()
    expect(r.fallbackUsed).toBe(false)
  })
})
