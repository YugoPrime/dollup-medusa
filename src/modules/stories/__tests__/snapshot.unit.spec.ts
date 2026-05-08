import { buildSnapshot, type ProductLike } from "../snapshot"

describe("buildSnapshot", () => {
  const baseProduct: ProductLike = {
    id: "prod_1",
    title: "Floral Wrap Dress",
    handle: "floral-wrap-dress",
    variants: [
      {
        id: "var_pink_s",
        sku: "IS2328-PINK-S",
        title: "Pink / S",
        inventory_quantity: 3,
        prices: [{ amount: 129000, currency_code: "mur" }],
        options: { color: "Pink", color_code: "#ff99c8", size: "S" },
        images: [
          { url: "https://r2/IS2328.jpg" },
          { url: "https://r2/IS2328-b.jpg" },
        ],
      },
      {
        id: "var_pink_m",
        sku: "IS2328-PINK-M",
        title: "Pink / M",
        inventory_quantity: 0,
        prices: [{ amount: 129000, currency_code: "mur" }],
        options: { color: "Pink", color_code: "#ff99c8", size: "M" },
        images: [],
      },
      {
        id: "var_blue_s",
        sku: "IS2328-BLUE-S",
        title: "Blue / S",
        inventory_quantity: 2,
        prices: [{ amount: 129000, currency_code: "mur" }],
        options: { color: "Blue", color_code: "#88aacc", size: "S" },
        images: [{ url: "https://r2/IS2328-2.jpg" }],
      },
    ],
  }

  it("produces a snapshot with one entry per in-stock color, with in-stock sizes only", () => {
    const snap = buildSnapshot(baseProduct)
    expect(snap.name).toBe("Floral Wrap Dress")
    expect(snap.handle).toBe("floral-wrap-dress")
    expect(snap.price_mur).toBe(1290)
    expect(snap.variant_in_stock_count).toBe(2)
    expect(snap.variants_in_stock).toHaveLength(2)
    const pink = snap.variants_in_stock.find((v) => v.color === "Pink")!
    expect(pink.sizes).toEqual(["S"])
    expect(pink.image_urls).toEqual([
      "https://r2/IS2328.jpg",
      "https://r2/IS2328-b.jpg",
    ])
    const blue = snap.variants_in_stock.find((v) => v.color === "Blue")!
    expect(blue.sizes).toEqual(["S"])
  })

  it("excludes products entirely if no variant is in stock", () => {
    const allOut: ProductLike = {
      ...baseProduct,
      variants: baseProduct.variants.map((v) => ({ ...v, inventory_quantity: 0 })),
    }
    expect(buildSnapshot(allOut).variants_in_stock).toEqual([])
    expect(buildSnapshot(allOut).variant_in_stock_count).toBe(0)
  })

  it("price_mur reflects display rupees, not display × 100 nor display ÷ 100", () => {
    // Regression: toProductLike previously fed raw_calculated_amount.value
    // (which equals display, e.g. "1290") into prices[].amount, then
    // snapshot.ts divided by 100 → Rs 13. Contract is now "amount = minor
    // units (display × 100)". For Rs 1290 expect amount=129000 → price_mur=1290.
    const product = {
      id: "prod_1",
      title: "Floral Wrap Dress",
      handle: "floral-wrap-dress",
      variants: [
        {
          id: "var_1",
          sku: null,
          title: null,
          inventory_quantity: 5,
          prices: [{ amount: 129000, currency_code: "mur" }],
          options: { color: "Pink", size: "M" },
          images: [{ url: "https://cdn.example/a.jpg" }],
        },
      ],
    }
    const snap = buildSnapshot(product)
    expect(snap.price_mur).toBe(1290)
  })
})
