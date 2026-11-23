import {
  buildCatalogueCards,
  formatMur,
  isAdultProduct,
  isUnlistedProduct,
  pickEmailImage,
  productUrl,
  toPickerRow,
  type CatalogueProduct,
} from "../lib/catalogue"

const prod = (o: Partial<CatalogueProduct> = {}): CatalogueProduct => ({
  id: "p",
  title: "Satin Dress",
  handle: "satin-dress",
  status: "published",
  thumbnail: "https://cdn.dollupboutique.com/a.webp",
  images: [{ url: "https://cdn.dollupboutique.com/a.jpg" }],
  categories: [{ handle: "dresses" }],
  metadata: null,
  variants: [
    {
      manage_inventory: false,
      calculated_price: { calculated_amount: 1290, original_amount: 1290 },
    },
  ],
  ...o,
})

describe("catalogue rules", () => {
  it("detects adult products", () => {
    expect(isAdultProduct({ categories: [{ handle: "toys" }] })).toBe(true)
    expect(isAdultProduct({ categories: [{ handle: "INTIMATES" }] })).toBe(true)
    expect(
      isAdultProduct({ categories: [{ handle: "accessories" }], metadata: { age_restricted: true } }),
    ).toBe(true)
    expect(isAdultProduct({ categories: [{ handle: "lingerie" }] })).toBe(false)
  })

  it("detects unlisted products", () => {
    expect(isUnlistedProduct({ metadata: { unlisted: true } })).toBe(true)
    expect(isUnlistedProduct({ metadata: null })).toBe(false)
  })

  it("picks a mail-safe image", () => {
    expect(pickEmailImage({ thumbnail: "https://x/a.webp", images: [{ url: "https://x/b.JPG" }] })).toBe(
      "https://x/b.JPG",
    )
    expect(pickEmailImage({ thumbnail: "https://x/a.webp", images: [{ url: "https://x/c.png?v=2" }] })).toBe(
      "https://x/c.png?v=2",
    )
    expect(pickEmailImage({ thumbnail: "https://x/a.webp", images: [] })).toBe("https://x/a.webp")
    expect(pickEmailImage({ thumbnail: null, images: null })).toBeNull()
  })

  it("formats prices with a plain space", () => {
    expect(formatMur(1290)).toBe("Rs 1,290")
  })

  it("builds product urls", () => {
    expect(productUrl("https://dollupboutique.com/", "satin-dress", "nlcamp_1")).toBe(
      "https://dollupboutique.com/products/satin-dress?utm_source=newsletter&utm_medium=email&utm_campaign=nlcamp_1",
    )
  })

  it("builds cards, keeps order and drops with reasons", () => {
    const r = buildCatalogueCards(
      [
        prod({ id: "a" }),
        prod({ id: "b", categories: [{ handle: "toys" }] }),
        prod({ id: "c", metadata: { unlisted: true } }),
        prod({ id: "d", status: "draft" }),
        prod({
          id: "e",
          variants: [
            {
              manage_inventory: true,
              inventory_items: [],
              calculated_price: { calculated_amount: 500, original_amount: 500 },
            },
          ],
        }),
        prod({
          id: "f",
          variants: [
            { manage_inventory: false, calculated_price: { calculated_amount: 990, original_amount: 1290 } },
          ],
        }),
      ],
      ["f", "a", "b", "c", "d", "e", "zzz"],
      { list: "main", storefrontUrl: "https://dollupboutique.com", campaignId: "nlcamp_1" },
    )
    expect(r.cards.map((c) => c.id)).toEqual(["f", "a"])
    expect(r.cards[0]).toMatchObject({ price: "Rs 990", originalPrice: "Rs 1,290" })
    expect(r.cards[1].originalPrice).toBeNull()
    expect(r.dropped.map((d) => [d.id, d.reason])).toEqual([
      ["b", "adult_on_main"],
      ["c", "unlisted"],
      ["d", "unpublished"],
      ["e", "out_of_stock"],
      ["zzz", "not_found"],
    ])
  })

  it("allows adult on after_dark but never unlisted", () => {
    expect(
      buildCatalogueCards([prod({ id: "b", categories: [{ handle: "toys" }] })], ["b"], {
        list: "after_dark",
        storefrontUrl: "https://d.com",
        campaignId: "x",
      }).cards,
    ).toHaveLength(1)
    expect(
      buildCatalogueCards([prod({ id: "c", metadata: { unlisted: true } })], ["c"], {
        list: "after_dark",
        storefrontUrl: "https://d.com",
        campaignId: "x",
      }).dropped[0].reason,
    ).toBe("unlisted")
  })

  it("uses the cheapest in-stock variant and reports no_price", () => {
    const r = buildCatalogueCards(
      [
        prod({
          id: "g",
          variants: [
            { manage_inventory: false, calculated_price: { calculated_amount: 800, original_amount: 800 } },
            { manage_inventory: true, inventory_items: [], calculated_price: { calculated_amount: 100, original_amount: 100 } },
            { manage_inventory: false, calculated_price: { calculated_amount: 700, original_amount: 900 } },
          ],
        }),
        prod({ id: "h", variants: [{ manage_inventory: false, calculated_price: null }] }),
      ],
      ["g", "h"],
      { list: "main", storefrontUrl: "https://d.com", campaignId: "x" },
    )
    expect(r.cards[0]).toMatchObject({ price: "Rs 700", originalPrice: "Rs 900" })
    expect(r.dropped).toEqual([{ id: "h", title: "Satin Dress", reason: "no_price" }])
  })

  it("caps cards at 24", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `p${i}`)
    const r = buildCatalogueCards(
      ids.map((id) => prod({ id })),
      ids,
      { list: "main", storefrontUrl: "https://d.com", campaignId: "x" },
    )
    expect(r.cards).toHaveLength(24)
  })

  it("maps picker rows", () => {
    expect(toPickerRow(prod({ id: "a" }))).toEqual({
      id: "a",
      title: "Satin Dress",
      handle: "satin-dress",
      imageUrl: "https://cdn.dollupboutique.com/a.jpg",
      price: "Rs 1,290",
      originalPrice: null,
      inStock: true,
      adult: false,
    })
    expect(toPickerRow(prod({ variants: [] }))).toMatchObject({ price: null, inStock: false })
  })
})
