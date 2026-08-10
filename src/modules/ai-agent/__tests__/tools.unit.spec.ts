import type { MedusaContainer } from "@medusajs/framework/types"

import { executeTool, priceOf, summarizeStock, TOOL_DEFINITIONS } from "../lib/tools"

const product = {
  id: "prod_1",
  title: "Robe Léa",
  handle: "robe-lea",
  variants: [
    {
      id: "var_s",
      title: "S",
      manage_inventory: true,
      inventory_items: [
        { inventory: { location_levels: [{ stocked_quantity: 5, reserved_quantity: 2 }] } },
      ],
      calculated_price: { calculated_amount: 1450, currency_code: "mur" },
    },
    {
      id: "var_m",
      title: "M",
      manage_inventory: true,
      inventory_items: [
        { inventory: { location_levels: [{ stocked_quantity: 0, reserved_quantity: 0 }] } },
      ],
      calculated_price: { calculated_amount: 1450, currency_code: "mur" },
    },
  ],
}

describe("summarizeStock", () => {
  it("subtracts reserved from stocked", () => {
    expect(summarizeStock(product)).toEqual({ inStock: 3, unlimited: false })
  })

  it("never reports negative stock", () => {
    const oversold = {
      variants: [
        {
          manage_inventory: true,
          inventory_items: [
            { inventory: { location_levels: [{ stocked_quantity: 1, reserved_quantity: 4 }] } },
          ],
        },
      ],
    }
    expect(summarizeStock(oversold).inStock).toBe(0)
  })

  it("flags unlimited when a variant does not manage inventory", () => {
    const unmanaged = { variants: [{ manage_inventory: false, inventory_items: [] }] }
    expect(summarizeStock(unmanaged)).toEqual({ inStock: 0, unlimited: true })
  })

  it("sums across several location levels", () => {
    const multi = {
      variants: [
        {
          manage_inventory: true,
          inventory_items: [
            {
              inventory: {
                location_levels: [
                  { stocked_quantity: 2, reserved_quantity: 0 },
                  { stocked_quantity: 3, reserved_quantity: 1 },
                ],
              },
            },
          ],
        },
      ],
    }
    expect(multi && summarizeStock(multi).inStock).toBe(4)
  })

  it("handles a product with no variants", () => {
    expect(summarizeStock({ variants: [] })).toEqual({ inStock: 0, unlimited: false })
  })
})

describe("priceOf", () => {
  it("reads calculated_amount in MUR major units", () => {
    expect(priceOf(product)).toBe(1450)
  })

  it("returns null when no price is calculated", () => {
    expect(priceOf({ variants: [{ calculated_price: null }] })).toBeNull()
    expect(priceOf({ variants: [] })).toBeNull()
  })
})

describe("TOOL_DEFINITIONS", () => {
  it("exposes exactly the five tools the loop expects", () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name).sort()).toEqual([
      "escalate_to_human",
      "get_product_details",
      "lookup_order",
      "search_products",
      "send_reply",
    ].sort())
  })

  it("marks every tool strict with a closed schema", () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(t.strict).toBe(true)
      expect(t.input_schema.additionalProperties).toBe(false)
      expect(Array.isArray(t.input_schema.required)).toBe(true)
    }
  })

  it("makes send_reply carry confidence, intent and language", () => {
    const reply = TOOL_DEFINITIONS.find((t) => t.name === "send_reply")!
    expect(Object.keys(reply.input_schema.properties).sort()).toEqual([
      "confidence",
      "intent",
      "language",
      "text",
    ])
  })

  it("is declared in a fixed order — the tool list is part of the cached prefix", () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual([
      "search_products",
      "get_product_details",
      "lookup_order",
      "send_reply",
      "escalate_to_human",
    ])
  })
})

/**
 * executeTool needs a container to resolve the query service from. There is
 * no database in this test run, so we hand-build a fake container whose
 * `resolve` returns an object with a `graph` method returning canned rows —
 * the same shape `query.graph` returns in production, just fixture-driven.
 */
function fakeScope(graphImpl: (args: unknown) => Promise<{ data: unknown[] }>): MedusaContainer {
  return {
    resolve: () => ({ graph: graphImpl }),
  } as unknown as MedusaContainer
}

describe("executeTool: search_products", () => {
  it("returns an empty result set for a blank query without calling the catalogue", async () => {
    const graph = jest.fn()
    const result = await executeTool(fakeScope(graph), "search_products", { query: "   " })
    expect(result).toEqual({ results: [] })
    expect(graph).not.toHaveBeenCalled()
  })

  it("never returns a product the query didn't match — it only ever passes through what query.graph returned", async () => {
    const graph = jest.fn().mockResolvedValue({ data: [] })
    const result = await executeTool(fakeScope(graph), "search_products", {
      query: "robe paillettes introuvable",
    })
    expect(result).toEqual({ results: [] })
    expect(graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "product",
        filters: expect.objectContaining({
          status: "published",
          q: "robe paillettes introuvable",
        }),
      }),
    )
  })

  it("maps exactly the rows the catalogue returned, one result per product, no invention", async () => {
    const graph = jest.fn().mockResolvedValue({
      data: [
        product,
        {
          id: "prod_2",
          title: "Jupe Maya",
          handle: "jupe-maya",
          variants: [{ manage_inventory: false, inventory_items: [] }],
        },
      ],
    })
    const result = (await executeTool(fakeScope(graph), "search_products", {
      query: "robe",
    })) as { results: Array<{ title: string; handle: string; available: boolean }> }
    expect(result.results).toHaveLength(2)
    expect(result.results.map((r) => r.handle)).toEqual(["robe-lea", "jupe-maya"])
    expect(result.results[0]).toEqual({
      title: "Robe Léa",
      handle: "robe-lea",
      price_mur: 1450,
      available: true,
      url: "https://dollupboutique.com/products/robe-lea",
    })
    expect(result.results[1].available).toBe(true) // unlimited variant
  })
})

describe("executeTool: get_product_details", () => {
  it("returns found: false when the handle doesn't match any published product", async () => {
    const graph = jest.fn().mockResolvedValue({ data: [] })
    const result = await executeTool(fakeScope(graph), "get_product_details", {
      handle: "does-not-exist",
    })
    expect(result).toEqual({ found: false })
  })

  it("reports real per-variant stock, not an aggregate", async () => {
    const graph = jest.fn().mockResolvedValue({ data: [product] })
    const result = (await executeTool(fakeScope(graph), "get_product_details", {
      handle: "robe-lea",
    })) as {
      found: boolean
      variants: Array<{ label: string; available: boolean; quantity: number | null }>
    }
    expect(result.found).toBe(true)
    expect(result.variants).toEqual([
      { label: "S", sku: null, options: [], available: true, quantity: 3 },
      { label: "M", sku: null, options: [], available: false, quantity: 0 },
    ])
  })
})

describe("executeTool: lookup_order", () => {
  const orderRow = {
    display_id: 595,
    status: "completed",
    fulfillment_status: "delivered",
    metadata: { rapido_status: "delivered" },
    items: [{ title: "Robe Léa", quantity: 1 }],
    shipping_address: { phone: "+230 5826 7091" },
  }

  it("returns full order info when the order number and phone match", async () => {
    const graph = jest.fn().mockResolvedValue({ data: [orderRow] })
    const result = await executeTool(fakeScope(graph), "lookup_order", {
      order_number: "#595",
      phone: "58267091",
    })
    expect(result).toEqual({
      found: true,
      order_number: 595,
      status: "completed",
      fulfillment_status: "delivered",
      rapido_status: "delivered",
      item_count: 1,
      items: ["Robe Léa"],
    })
  })

  it("never leaks address, email or name", async () => {
    const graph = jest.fn().mockResolvedValue({ data: [orderRow] })
    const result = (await executeTool(fakeScope(graph), "lookup_order", {
      order_number: "595",
      phone: "+230 5826 7091",
    })) as Record<string, unknown>
    expect(result).not.toHaveProperty("address")
    expect(result).not.toHaveProperty("email")
    expect(result).not.toHaveProperty("name")
    expect(result).not.toHaveProperty("shipping_address")
  })

  // The phone check is the security boundary: a web visitor has no linked
  // customer account, so a matching phone is the only thing standing between
  // a guessed order number and someone else's order data.
  it("returns found: false when the phone does not match the order on file", async () => {
    const graph = jest.fn().mockResolvedValue({ data: [orderRow] })
    const result = await executeTool(fakeScope(graph), "lookup_order", {
      order_number: "595",
      phone: "5555555",
    })
    expect(result).toEqual({ found: false })
  })

  it("returns found: false when the order number doesn't exist", async () => {
    const graph = jest.fn().mockResolvedValue({ data: [] })
    const result = await executeTool(fakeScope(graph), "lookup_order", {
      order_number: "999999",
      phone: "58267091",
    })
    expect(result).toEqual({ found: false })
  })

  it("returns found: false without querying when the phone is too short to be real", async () => {
    const graph = jest.fn()
    const result = await executeTool(fakeScope(graph), "lookup_order", {
      order_number: "595",
      phone: "123",
    })
    expect(result).toEqual({ found: false })
    expect(graph).not.toHaveBeenCalled()
  })
})

describe("executeTool: unknown tool", () => {
  it("throws rather than silently doing nothing", async () => {
    const graph = jest.fn()
    await expect(
      executeTool(fakeScope(graph), "delete_everything", {}),
    ).rejects.toThrow("Unknown tool: delete_everything")
  })
})
