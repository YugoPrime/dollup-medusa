import { resolveRotationStart } from "../grid-planner"

describe("resolveRotationStart", () => {
  const rows = [
    { post_date: "2026-11-02", metadata: { rotation_category: "dresses" } },
    { post_date: "2026-11-03", metadata: { rotation_category: "lingerie" } },
    { post_date: "2026-11-05", metadata: null },
  ]

  it("returns the category of the latest row before the date", () => {
    expect(resolveRotationStart(rows, "2026-11-04")).toBe("lingerie")
  })

  it("returns null when that row has no category (next is dresses)", () => {
    expect(resolveRotationStart(rows, "2026-11-06")).toBeNull()
  })

  it("returns null with no earlier rows", () => {
    expect(resolveRotationStart([], "2026-11-01")).toBeNull()
  })

  it("ignores rows on or after the date, whatever their order", () => {
    const shuffled = [rows[2], rows[0], rows[1]]
    expect(resolveRotationStart(shuffled, "2026-11-03")).toBe("dresses")
  })
})

import type { ProductLike } from "../../modules/stories/snapshot"
import { chooseGridForDate, type GridContext } from "../grid-planner"

function product(id: string, tags: string[] = ["collection30"]): ProductLike {
  return {
    id,
    title: id,
    handle: id,
    created_at: "2026-01-01T00:00:00Z",
    tags,
    variants: [
      {
        id: `${id}_v`,
        inventory_quantity: 2,
        prices: [{ amount: 100000, currency_code: "mur" }],
        options: { color: "Red", size: "M" },
      },
    ],
  }
}

function ctx(over: Partial<GridContext> = {}): GridContext {
  return {
    history: [],
    candidatesByKey: { dresses: [product("d1")], lingerie: [product("l1")], beachwear: [product("b1")] },
    settings: { focus_tag: "collection30", focus_until: "2027-02-28", collection_boost: 3, collection_boost_days: 14 },
    dedupDays: 30,
    ...over,
  }
}

const NOW = Date.parse("2026-11-03T10:00:00Z")

describe("chooseGridForDate", () => {
  it("continues the rotation from the latest earlier post", () => {
    const c = ctx({ history: [{ post_date: "2026-11-03", product_id: "dX", status: "posted", metadata: { rotation_category: "dresses" } }] })
    expect(chooseGridForDate(c, "2026-11-04", new Set(), NOW)).toEqual({ product: expect.objectContaining({ id: "l1" }), rotation: "lingerie" })
  })

  it("moves to the next category when the due one has nothing", () => {
    const c = ctx({ candidatesByKey: { dresses: [], lingerie: [product("l1")], beachwear: [product("b1")] } })
    expect(chooseGridForDate(c, "2026-11-04", new Set(), NOW)?.rotation).toBe("lingerie")
  })

  it("never picks an excluded product (e.g. in that day's stories)", () => {
    const c = ctx({ candidatesByKey: { dresses: [product("d1")], lingerie: [product("l1")], beachwear: [] } })
    expect(chooseGridForDate(c, "2026-11-04", new Set(["d1"]), NOW)?.product.id).toBe("l1")
  })

  it("treats a product planned later in the week as recently posted", () => {
    const c = ctx({
      candidatesByKey: { dresses: [product("fA"), product("fB")], lingerie: [], beachwear: [] },
      history: [
        { post_date: "2026-10-20", product_id: "fA", status: "posted", metadata: { rotation_category: "dresses" } },
        { post_date: "2026-10-25", product_id: "fB", status: "posted", metadata: { rotation_category: "dresses" } },
        { post_date: "2026-11-06", product_id: "fA", status: "planned", metadata: { rotation_category: "dresses" } },
      ],
    })
    expect(chooseGridForDate(c, "2026-11-04", new Set(), NOW)?.product.id).toBe("fB")
  })

  it("returns null when no category has anything", () => {
    const c = ctx({ candidatesByKey: { dresses: [], lingerie: [], beachwear: [] } })
    expect(chooseGridForDate(c, "2026-11-04", new Set(), NOW)).toBeNull()
  })
})
