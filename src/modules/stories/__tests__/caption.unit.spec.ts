import { renderCaption, STOREFRONT_BASE_URL } from "../caption"
import type { ProductSnapshot } from "../snapshot"

describe("renderCaption", () => {
  const snap: ProductSnapshot = {
    name: "Floral Wrap Dress",
    handle: "floral-wrap-dress",
    price_mur: 1290,
    compare_at_price_mur: null,
    variants_in_stock: [
      { id: "v1", color: "Pink", color_code: "#f", sizes: ["S", "M"], image_urls: [] },
      { id: "v2", color: "Blue", color_code: "#b", sizes: ["S"], image_urls: [] },
    ],
    variant_in_stock_count: 2,
    picked_at: new Date().toISOString(),
  }

  it("substitutes name, price, sizes, link", () => {
    const tpl = "{name} — Rs {price} · {sizes} · {link}"
    expect(renderCaption(tpl, snap)).toBe(
      `Floral Wrap Dress — Rs 1,290 · S/M · ${STOREFRONT_BASE_URL}/products/floral-wrap-dress`,
    )
  })

  it("dedupes sizes across colors and joins with /", () => {
    const tpl = "{sizes}"
    expect(renderCaption(tpl, snap)).toBe("S/M")
  })

  it("renders {compare_at_price} as empty when null", () => {
    const tpl = "Was Rs {compare_at_price}, now Rs {price}"
    expect(renderCaption(tpl, snap)).toBe("Was Rs , now Rs 1,290")
  })

  it("renders {compare_at_price} formatted when set", () => {
    const tpl = "{compare_at_price} → {price}"
    expect(renderCaption(tpl, { ...snap, compare_at_price_mur: 1990 })).toBe("1,990 → 1,290")
  })
})
