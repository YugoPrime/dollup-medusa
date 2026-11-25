import { formatRs, priceForPhoto, productCode } from "../feed-price-label"

describe("formatRs", () => {
  it("writes rupees with a thousands comma", () => {
    expect(formatRs(975)).toBe("Rs 975")
    expect(formatRs(1100)).toBe("Rs 1,100")
  })
})

describe("priceForPhoto", () => {
  const snapshot = {
    handle: "is2462",
    price_mur: 975,
    compare_at_price_mur: null,
    variants_in_stock: [
      { color: "Red", image_urls: ["r.jpg", "r-b.jpg"], price_mur: 975, price_max_mur: 975, compare_at_price_mur: null },
      { color: "White", image_urls: ["w.jpg"], price_mur: 1050, price_max_mur: 1050, compare_at_price_mur: null },
    ],
  }

  it("gives a photo the price of the colour it shows", () => {
    expect(priceForPhoto(snapshot, "r-b.jpg")).toEqual({ price_mur: 975, from: false, was_mur: null })
    expect(priceForPhoto(snapshot, "w.jpg")).toEqual({ price_mur: 1050, from: false, was_mur: null })
  })

  it("says 'from' the lowest price when no colour claims the photo and colours differ", () => {
    expect(priceForPhoto(snapshot, "lookbook.jpg")).toEqual({ price_mur: 975, from: true, was_mur: null })
  })

  it("says 'from' when the sizes of one colour are priced differently", () => {
    const perSize = {
      variants_in_stock: [{ image_urls: ["a.jpg"], price_mur: 450, price_max_mur: 600, compare_at_price_mur: null }],
    }
    expect(priceForPhoto(perSize, "a.jpg")).toEqual({ price_mur: 450, from: true, was_mur: null })
  })

  it("keeps the pre-sale price when the piece is on sale", () => {
    const sale = {
      variants_in_stock: [{ image_urls: ["a.jpg"], price_mur: 770, price_max_mur: 770, compare_at_price_mur: 1100 }],
    }
    expect(priceForPhoto(sale, "a.jpg")).toEqual({ price_mur: 770, from: false, was_mur: 1100 })
  })

  it("falls back to the product price on a snapshot saved before colours had prices", () => {
    const old = {
      price_mur: 690,
      compare_at_price_mur: 990,
      variants_in_stock: [{ color: "Black", image_urls: ["a.jpg"] }],
    }
    expect(priceForPhoto(old, "a.jpg")).toEqual({ price_mur: 690, from: false, was_mur: 990 })
  })

  it("returns null when there is no price to show", () => {
    expect(priceForPhoto({ price_mur: 0, variants_in_stock: [{ image_urls: ["a.jpg"] }] }, "a.jpg")).toBeNull()
    expect(priceForPhoto(null, "a.jpg")).toBeNull()
  })
})

describe("productCode", () => {
  it("is the handle in capitals when the handle is the code", () => {
    expect(productCode({ handle: "is2462" })).toBe("IS2462")
    expect(productCode({ handle: "ts13" })).toBe("TS13")
  })

  it("takes the SKU stem when the handle is a slug", () => {
    expect(
      productCode({ handle: "floral-wrap-dress", variants_in_stock: [{ sku: "IS2328-PINK-S" }] }),
    ).toBe("IS2328")
  })

  it("is null when nothing looks like a code", () => {
    expect(productCode({ handle: "floral-wrap-dress", variants_in_stock: [{ sku: null }] })).toBeNull()
    expect(productCode(undefined)).toBeNull()
  })
})
