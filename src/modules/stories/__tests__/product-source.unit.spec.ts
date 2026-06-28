import { collectCategoryAndDescendants, toProductLike } from "../product-source"

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

describe("collectCategoryAndDescendants", () => {
  // Mirrors the live Doll Up tree: "Beachwear" parent with Bikini Sets /
  // Cover-Ups / One-Pieces children, plus an unrelated branch.
  const CATS = [
    { id: "beachwear", parent_category_id: null },
    { id: "bikini-sets", parent_category_id: "beachwear" },
    { id: "cover-ups", parent_category_id: "beachwear" },
    { id: "one-pieces", parent_category_id: "beachwear" },
    { id: "string-bikinis", parent_category_id: "bikini-sets" }, // grandchild
    { id: "dresses", parent_category_id: null },
    { id: "two-piece-outfits", parent_category_id: "clothing" },
    { id: "clothing", parent_category_id: null },
  ]

  it("returns the root plus all descendants (recursively)", () => {
    expect(collectCategoryAndDescendants(CATS, "beachwear").sort()).toEqual(
      ["beachwear", "bikini-sets", "cover-ups", "one-pieces", "string-bikinis"].sort(),
    )
  })

  it("includes deep grandchildren", () => {
    expect(collectCategoryAndDescendants(CATS, "bikini-sets").sort()).toEqual(
      ["bikini-sets", "string-bikinis"].sort(),
    )
  })

  it("returns just the root for a leaf category", () => {
    expect(collectCategoryAndDescendants(CATS, "dresses")).toEqual(["dresses"])
  })

  it("returns just the root id when the category isn't in the list", () => {
    expect(collectCategoryAndDescendants(CATS, "unknown")).toEqual(["unknown"])
  })

  it("does not cross into unrelated branches", () => {
    const out = collectCategoryAndDescendants(CATS, "beachwear")
    expect(out).not.toContain("two-piece-outfits")
    expect(out).not.toContain("dresses")
  })

  it("never infinite-loops on a cyclic parent reference", () => {
    const cyclic = [
      { id: "a", parent_category_id: "b" },
      { id: "b", parent_category_id: "a" },
    ]
    const out = collectCategoryAndDescendants(cyclic, "a").sort()
    expect(out).toEqual(["a", "b"])
  })
})

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

  it("partitions product images per variant by the color token in the filename", () => {
    // Regression: before this fix, every variant received the full product
    // image list — the slot detail page showed every red and black image
    // under BOTH the RED and BLACK color rows, and the picker's 2-color
    // template grabbed two red fronts instead of one red + one black.
    const twoColors = {
      id: "prod_is1070",
      title: "Mesh Sensual Lingerie Set",
      handle: "is1070",
      created_at: "2026-05-01T00:00:00Z",
      metadata: null,
      images: [
        { url: "https://r2/is1070/is1070-s-red-front.png" },
        { url: "https://r2/is1070/is1070-s-red-back.png" },
        { url: "https://r2/is1070/is1070-s-red-real.jpg" },
        { url: "https://r2/is1070/is1070-s-black-front.png" },
        { url: "https://r2/is1070/is1070-s-black-back.png" },
      ],
      variants: [
        {
          id: "v_red",
          sku: "IS1070-S-Red",
          title: "S / Red",
          manage_inventory: true,
          inventory_items: [
            {
              required_quantity: 1,
              inventory: {
                location_levels: [{ stocked_quantity: 2, reserved_quantity: 0 }],
              },
            },
          ],
          options: [
            { value: "Red", option: { title: "Color" } },
            { value: "S", option: { title: "Size" } },
          ],
          calculated_price: { calculated_amount: 950, currency_code: "mur" },
        },
        {
          id: "v_black",
          sku: "IS1070-S-Black",
          title: "S / Black",
          manage_inventory: true,
          inventory_items: [
            {
              required_quantity: 1,
              inventory: {
                location_levels: [{ stocked_quantity: 1, reserved_quantity: 0 }],
              },
            },
          ],
          options: [
            { value: "Black", option: { title: "Color" } },
            { value: "S", option: { title: "Size" } },
          ],
          calculated_price: { calculated_amount: 950, currency_code: "mur" },
        },
      ],
    }
    const out = toProductLike(twoColors)
    expect(out.variants[0].images.map((i) => i.url)).toEqual([
      "https://r2/is1070/is1070-s-red-front.png",
      "https://r2/is1070/is1070-s-red-back.png",
      "https://r2/is1070/is1070-s-red-real.jpg",
    ])
    expect(out.variants[1].images.map((i) => i.url)).toEqual([
      "https://r2/is1070/is1070-s-black-front.png",
      "https://r2/is1070/is1070-s-black-back.png",
    ])
  })

  it("falls back to the full image list when the variant's color isn't found in any filename", () => {
    // Older products that pre-date the color-encoded filename convention
    // shouldn't lose all images — the picker would skip the slot. Falling
    // back to the unpartitioned list keeps them working.
    const legacy = {
      ...SAMPLE,
      images: [
        { url: "https://r2/legacy/no-color-in-name.jpg" },
        { url: "https://r2/legacy/another.jpg" },
      ],
    }
    const out = toProductLike(legacy)
    expect(out.variants[0].images.map((i) => i.url)).toEqual([
      "https://r2/legacy/no-color-in-name.jpg",
      "https://r2/legacy/another.jpg",
    ])
  })
})
