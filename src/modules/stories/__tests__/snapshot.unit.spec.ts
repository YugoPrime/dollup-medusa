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
    expect(pink.sku).toBe("IS2328-PINK-S")
    expect(pink.image_urls).toEqual([
      "https://r2/IS2328.jpg",
      "https://r2/IS2328-b.jpg",
    ])
    const blue = snap.variants_in_stock.find((v) => v.color === "Blue")!
    expect(blue.sizes).toEqual(["S"])
    expect(blue.sku).toBe("IS2328-BLUE-S")
  })

  it("gives each colour its own price: lowest, highest and the lowest one's pre-sale price", () => {
    const snap = buildSnapshot({
      ...baseProduct,
      variants: [
        { ...baseProduct.variants[0], prices: [{ amount: 77000, currency_code: "mur" }], compare_at_amount: 110000 },
        { ...baseProduct.variants[1], inventory_quantity: 4, prices: [{ amount: 99000, currency_code: "mur" }] },
        baseProduct.variants[2],
      ],
    })
    const pink = snap.variants_in_stock.find((v) => v.color === "Pink")!
    expect([pink.price_mur, pink.price_max_mur, pink.compare_at_price_mur]).toEqual([770, 990, 1100])
    const blue = snap.variants_in_stock.find((v) => v.color === "Blue")!
    expect([blue.price_mur, blue.price_max_mur, blue.compare_at_price_mur]).toEqual([1290, 1290, null])
  })

  it("excludes products entirely if no variant is in stock", () => {
    const allOut: ProductLike = {
      ...baseProduct,
      variants: baseProduct.variants.map((v) => ({ ...v, inventory_quantity: 0 })),
    }
    expect(buildSnapshot(allOut).variants_in_stock).toEqual([])
    expect(buildSnapshot(allOut).variant_in_stock_count).toBe(0)
  })

  it("sets compare_at_price_mur when compare_at_amount on first in-stock variant is greater than price", () => {
    const onSale: ProductLike = {
      id: "prod_2",
      title: "Sale Dress",
      handle: "sale-dress",
      variants: [
        {
          id: "v1",
          sku: "S-1",
          title: null,
          inventory_quantity: 4,
          prices: [{ amount: 99000, currency_code: "mur" }],
          compare_at_amount: 149000,
          options: { color: "Pink", size: "S" },
          images: [{ url: "https://r2/s.jpg" }],
        },
      ],
    }
    const snap = buildSnapshot(onSale)
    expect(snap.price_mur).toBe(990)
    expect(snap.compare_at_price_mur).toBe(1490)
  })

  it("ignores compare_at_amount when it is not strictly greater than active price", () => {
    const notOnSale: ProductLike = {
      id: "prod_3",
      title: "Regular",
      handle: "regular",
      variants: [
        {
          id: "v1",
          sku: null,
          title: null,
          inventory_quantity: 4,
          prices: [{ amount: 149000, currency_code: "mur" }],
          compare_at_amount: 149000,
          options: { color: "Pink", size: "S" },
          images: [{ url: "https://r2/r.jpg" }],
        },
      ],
    }
    expect(buildSnapshot(notOnSale).compare_at_price_mur).toBeNull()
  })

  it("leaves compare_at_price_mur null when compare_at_amount is undefined", () => {
    const snap = buildSnapshot(baseProduct)
    expect(snap.compare_at_price_mur).toBeNull()
  })

  it("marks is_new_arrival=true when product.created_at is within 30 days", () => {
    const fresh: ProductLike = {
      ...baseProduct,
      created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    }
    expect(buildSnapshot(fresh).is_new_arrival).toBe(true)
  })

  it("marks is_new_arrival=false when product.created_at is older than 30 days", () => {
    const old: ProductLike = {
      ...baseProduct,
      created_at: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    }
    expect(buildSnapshot(old).is_new_arrival).toBe(false)
  })

  it("defaults is_new_arrival=false when product.created_at is absent", () => {
    expect(buildSnapshot(baseProduct).is_new_arrival).toBe(false)
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

  it("keeps a size-only product (no Color option) as ONE colour with all its in-stock sizes", () => {
    // Regression (Rahvi, 25 Nov, IS2503 Strapless Bikini Set: options = Size only).
    // Each size used to become its own "colour", so stories picked a
    // multi-colour template and showed S on one picture and M on the next.
    const size = (s: string, qty: number) => ({
      id: `var_${s}`,
      sku: `IS2503-${s}`,
      title: s,
      inventory_quantity: qty,
      prices: [{ amount: 75000, currency_code: "mur" }],
      options: { size: s },
      images: [{ url: "https://r2/is2503-1.jpg" }, { url: "https://r2/is2503-2.jpg" }],
    })
    const product: ProductLike = {
      id: "prod_is2503",
      title: "Strapless Bikini Set",
      handle: "is2503",
      variants: [size("S", 2), size("M", 1), size("L", 3), size("XL", 0)],
    }
    const snap = buildSnapshot(product)
    expect(snap.variant_in_stock_count).toBe(1)
    expect(snap.variants_in_stock).toHaveLength(1)
    expect(snap.variants_in_stock[0].color).toBeNull()
    expect(snap.variants_in_stock[0].sizes).toEqual(["S", "M", "L"])
    expect(snap.variants_in_stock[0].image_urls).toEqual([
      "https://r2/is2503-1.jpg",
      "https://r2/is2503-2.jpg",
    ])
  })
})
