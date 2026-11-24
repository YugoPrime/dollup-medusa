import {
  computeStockValue,
  landedUnitCostMur,
  normaliseCostMur,
  pickSourcingCosts,
  plainMurPrice,
  toSnapProducts,
  type RawProduct,
} from "../stock-snapshot"

function level(stocked: number, reserved = 0) {
  return { stocked_quantity: stocked, reserved_quantity: reserved }
}

function variant(
  id: string,
  opts: {
    stock?: number[]
    reserved?: number
    price?: number
    cost?: number
    manage?: boolean
    extraPrices?: Record<string, unknown>[]
  } = {},
) {
  return {
    id,
    manage_inventory: opts.manage ?? true,
    metadata: opts.cost != null ? { cost_mur: opts.cost } : {},
    prices: [
      { amount: opts.price ?? 500, currency_code: "mur", price_list_id: null, rules_count: 0 },
      ...(opts.extraPrices ?? []),
    ],
    inventory_items: [
      {
        inventory: {
          location_levels: (opts.stock ?? [0]).map((s, i) =>
            level(s, i === 0 ? (opts.reserved ?? 0) : 0),
          ),
        },
      },
    ],
  }
}

describe("cost helpers (same rules as the admin Restock report)", () => {
  it("divides a cost stored x100 (collection28) back to rupees", () => {
    expect(normaliseCostMur(52385, 975)).toBeCloseTo(523.85)
    expect(normaliseCostMur(400, 975)).toBe(400)
    expect(normaliseCostMur(0, 975)).toBeNull()
    expect(normaliseCostMur(null, 975)).toBeNull()
    expect(normaliseCostMur(Number.NaN, 975)).toBeNull()
  })

  it("prices a sourcing item as USD x FX x multiplier, with no flat add", () => {
    expect(landedUnitCostMur(2, 51, 1.5)).toBe(153)
  })
})

describe("plainMurPrice", () => {
  it("takes the plain MUR price, never a sale price list's", () => {
    expect(
      plainMurPrice([
        { amount: 780, currency_code: "mur", price_list_id: "plist_bf", rules_count: 0 },
        { amount: 975, currency_code: "mur", price_list_id: null, rules_count: 0 },
      ]),
    ).toBe(975)
  })

  it("prefers a price with no rules, and ignores other currencies", () => {
    expect(
      plainMurPrice([
        { amount: 20, currency_code: "usd", price_list_id: null, rules_count: 0 },
        { amount: 900, currency_code: "mur", price_list_id: null, rules_count: 1 },
        { amount: 950, currency_code: "MUR", price_list_id: null, rules_count: 0 },
      ]),
    ).toBe(950)
  })

  it("is null when there is no MUR price", () => {
    expect(plainMurPrice([])).toBeNull()
    expect(plainMurPrice(null)).toBeNull()
  })
})

describe("toSnapProducts", () => {
  it("sums stock over every location level minus reserved, and never goes below 0", () => {
    const rows: RawProduct[] = [
      {
        id: "prod_a",
        variants: [variant("v1", { stock: [3, 2], reserved: 1 }), variant("v2", { stock: [1], reserved: 4 })],
      },
    ]
    const [p] = toSnapProducts(rows)
    expect(p.variants.map((v) => v.stock)).toEqual([4, 0])
  })

  it("skips variants that don't track stock and counts a tracked variant with no inventory item as 0", () => {
    const rows: RawProduct[] = [
      {
        id: "prod_a",
        variants: [
          variant("v1", { stock: [5], manage: false }),
          { ...variant("v2"), inventory_items: [] },
          variant("v3", { stock: [2] }),
        ],
      },
    ]
    const [p] = toSnapProducts(rows)
    expect(p.variants.map((v) => [v.id, v.stock])).toEqual([
      ["v2", 0],
      ["v3", 2],
    ])
  })

  it("reads amounts that come back as strings or BigNumber-like objects", () => {
    const rows = [
      {
        id: "prod_a",
        variants: [
          {
            id: "v1",
            manage_inventory: true,
            metadata: { cost_mur: "300" },
            prices: [{ amount: { valueOf: () => 975 }, currency_code: "mur", price_list_id: null, rules_count: 0 }],
            inventory_items: [{ inventory: { location_levels: [{ stocked_quantity: "6", reserved_quantity: "1" }] } }],
          },
        ],
      },
    ] as unknown as RawProduct[]
    expect(toSnapProducts(rows)[0].variants[0]).toEqual({
      id: "v1",
      stock: 5,
      priceMur: 975,
      costMur: 300,
    })
  })
})

describe("pickSourcingCosts", () => {
  it("keeps each product's latest batch, by arrival (received, else published)", () => {
    const costs = pickSourcingCosts(
      [
        {
          published_product_id: "prod_a",
          cost_usd: 2,
          published_at: "2026-09-01T10:00:00Z",
          draft_order: { landed_cost_multiplier: 1.5, received_at: "2026-09-01T10:00:00Z" },
        },
        {
          published_product_id: "prod_a",
          cost_usd: 3,
          published_at: null,
          draft_order: { landed_cost_multiplier: 2, received_at: "2026-11-01T10:00:00Z" },
        },
        {
          published_product_id: "prod_b",
          cost_usd: 1,
          published_at: "2026-10-05T10:00:00Z",
          draft_order: { landed_cost_multiplier: 1.5, received_at: null },
        },
      ],
      50,
    )
    expect(costs.get("prod_a")).toBe(300)
    expect(costs.get("prod_b")).toBe(75)
  })

  it("skips items with no product or no batch", () => {
    const costs = pickSourcingCosts(
      [
        { published_product_id: null, cost_usd: 2, published_at: null, draft_order: { landed_cost_multiplier: 1.5, received_at: null } },
        { published_product_id: "prod_c", cost_usd: 2, published_at: null, draft_order: null },
      ],
      50,
    )
    expect(costs.size).toBe(0)
  })
})

describe("computeStockValue", () => {
  it("values stock at the sourcing cost first, then the variants' fixed cost_mur, else counts it as uncosted", () => {
    const products = toSnapProducts([
      // Sourced: 4 pcs at Rs 153 landed (and its own cost_mur is ignored).
      { id: "prod_src", variants: [variant("s1", { stock: [4], price: 600, cost: 999 })] },
      // Older stock: cost_mur stored x100 on one variant, plain on the other: mean (400 + 450) / 2.
      {
        id: "prod_old",
        variants: [
          variant("o1", { stock: [2], price: 975, cost: 40000 }),
          variant("o2", { stock: [1], price: 975, cost: 450 }),
        ],
      },
      // No cost anywhere.
      { id: "prod_none", variants: [variant("n1", { stock: [5], price: 300 })] },
      // Nothing in stock.
      { id: "prod_empty", variants: [variant("e1", { stock: [0], price: 300, cost: 100 })] },
    ])
    const value = computeStockValue(products, new Map([["prod_src", 153]]))
    expect(value).toEqual({
      units: 12,
      cost_value_mur: 4 * 153 + 3 * 425,
      retail_value_mur: 4 * 600 + 3 * 975 + 5 * 300,
      uncosted_units: 5,
      products: 3,
    })
  })

  it("falls back to cost_mur when the latest batch has no cost", () => {
    const products = toSnapProducts([
      { id: "prod_a", variants: [variant("a1", { stock: [2], price: 500, cost: 200 })] },
    ])
    expect(computeStockValue(products, new Map([["prod_a", 0]])).cost_value_mur).toBe(400)
  })

  it("rounds money to whole rupees", () => {
    const products = toSnapProducts([
      { id: "prod_a", variants: [variant("a1", { stock: [3], price: 499.5, cost: 100.4 })] },
    ])
    const value = computeStockValue(products, new Map())
    expect(value.cost_value_mur).toBe(301)
    expect(value.retail_value_mur).toBe(1499)
  })
})
