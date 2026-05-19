import { toProductLike } from "../product-source"

const SAMPLE = {
  id: "prod_1",
  title: "Black Bikini",
  handle: "is2290",
  created_at: "2026-05-01T00:00:00Z",
  metadata: null,
  images: [
    { url: "https://r2.example/products/is2290/is2290-white-front.jpg" },
  ],
  variants: [
    {
      id: "var_1",
      sku: "IS2290-WHITE-M",
      title: "White / M",
      manage_inventory: true,
      inventory_items: [
        {
          required_quantity: 1,
          inventory: { location_levels: [{ stocked_quantity: 5, reserved_quantity: 0 }] },
        },
      ],
      options: [
        { value: "White", option: { title: "Color" } },
        { value: "M", option: { title: "Size" } },
      ],
      calculated_price: { calculated_amount: 1100, currency_code: "mur" },
    },
  ],
}

describe("toProductLike", () => {
  it("includes product.images on every variant by default", () => {
    const out = toProductLike(SAMPLE)
    expect(out.variants[0].images).toEqual([
      { url: "https://r2.example/products/is2290/is2290-white-front.jpg" },
    ])
  })

  it("appends product.metadata.cutout_image_url to every variant when present", () => {
    const withCutout = {
      ...SAMPLE,
      metadata: {
        cutout_image_url: "https://r2.example/products/is2290/IS2290-white-cutout.png",
      },
    }
    const out = toProductLike(withCutout)
    expect(out.variants[0].images).toEqual([
      { url: "https://r2.example/products/is2290/is2290-white-front.jpg" },
      { url: "https://r2.example/products/is2290/IS2290-white-cutout.png" },
    ])
  })

  it("ignores cutout_image_url when it's not a non-empty string", () => {
    const cases = [
      null,
      undefined,
      "",
      42,
      { url: "x" },
    ]
    for (const v of cases) {
      const out = toProductLike({ ...SAMPLE, metadata: { cutout_image_url: v } })
      expect(out.variants[0].images).toHaveLength(1)
    }
  })

  it("propagates the cutout URL across all variants in a multi-variant product", () => {
    const multi = {
      ...SAMPLE,
      metadata: {
        cutout_image_url: "https://r2.example/IS2290-cutout.png",
      },
      variants: [
        { ...SAMPLE.variants[0], id: "v1" },
        { ...SAMPLE.variants[0], id: "v2" },
      ],
    }
    const out = toProductLike(multi)
    for (const v of out.variants) {
      expect(v.images).toContainEqual({
        url: "https://r2.example/IS2290-cutout.png",
      })
    }
  })

  it("preserves order: original product images first, cutout appended last (matters for snapshot/picker fallback rules)", () => {
    const withMany = {
      ...SAMPLE,
      images: [
        { url: "https://r2/a.jpg" },
        { url: "https://r2/b.jpg" },
      ],
      metadata: { cutout_image_url: "https://r2/x-cutout.png" },
    }
    const out = toProductLike(withMany)
    expect(out.variants[0].images.map((i) => i.url)).toEqual([
      "https://r2/a.jpg",
      "https://r2/b.jpg",
      "https://r2/x-cutout.png",
    ])
  })
})
