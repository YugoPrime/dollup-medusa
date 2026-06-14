import {
  buildFeedCaption,
  selectFeedImages,
  IG_CAROUSEL_MAX,
} from "../feed-post-content"
import type { ProductSnapshot } from "../../modules/stories/snapshot"

const snap: Pick<
  ProductSnapshot,
  "name" | "handle" | "price_mur" | "compare_at_price_mur" | "variants_in_stock"
> = {
  name: "Floral Wrap Dress",
  handle: "is2448",
  price_mur: 1290,
  compare_at_price_mur: null,
  variants_in_stock: [
    {
      id: "v1",
      sku: "IS2448-PINK-S",
      color: "Pink",
      color_code: null,
      sizes: ["S", "M"],
      image_urls: [
        "https://cdn/is2448-pink-front.jpg",
        "https://cdn/is2448-pink-back.jpg",
        "https://cdn/is2448-pink-cutout.png",
      ],
    },
    {
      id: "v2",
      sku: "IS2448-BLUE-M",
      color: "Blue",
      color_code: null,
      sizes: ["M", "L"],
      image_urls: [
        "https://cdn/is2448-blue-front.jpg",
        "https://cdn/is2448-pink-front.jpg", // duplicate across colors
      ],
    },
  ],
}

describe("selectFeedImages", () => {
  it("collects color-by-color, drops cutouts and dedupes", () => {
    const imgs = selectFeedImages(snap)
    expect(imgs).toEqual([
      "https://cdn/is2448-pink-front.jpg",
      "https://cdn/is2448-pink-back.jpg",
      "https://cdn/is2448-blue-front.jpg",
    ])
    expect(imgs.some((u) => u.includes("cutout"))).toBe(false)
  })

  it("caps at the carousel max", () => {
    const many: typeof snap = {
      ...snap,
      variants_in_stock: [
        {
          id: "v",
          sku: "X",
          color: "Red",
          color_code: null,
          sizes: ["S"],
          image_urls: Array.from({ length: 15 }, (_, i) => `https://cdn/x-${i}.jpg`),
        },
      ],
    }
    expect(selectFeedImages(many)).toHaveLength(IG_CAROUSEL_MAX)
  })

  it("falls back to non-jpeg photos when no jpeg exists", () => {
    const pngOnly: typeof snap = {
      ...snap,
      variants_in_stock: [
        {
          id: "v",
          sku: "X",
          color: "Red",
          color_code: null,
          sizes: ["S"],
          image_urls: ["https://cdn/x-front.webp", "https://cdn/x-back.png"],
        },
      ],
    }
    expect(selectFeedImages(pngOnly)).toEqual([
      "https://cdn/x-front.webp",
      "https://cdn/x-back.png",
    ])
  })
})

describe("buildFeedCaption", () => {
  it("includes price, ref/SKU, sizes, colors, link and footer", () => {
    const cap = buildFeedCaption(snap, { footer: "DM to order", hashtags: "#x" })
    expect(cap).toContain("Floral Wrap Dress")
    expect(cap).toContain("Rs 1,290")
    expect(cap).toContain("Ref: IS2448")
    expect(cap).toContain("S · M · L")
    expect(cap).toContain("Pink · Blue")
    expect(cap).toContain("/products/is2448")
    expect(cap).toContain("DM to order")
    expect(cap).toContain("#x")
  })

  it("shows the was-price when on sale", () => {
    const cap = buildFeedCaption({ ...snap, compare_at_price_mur: 1990 })
    expect(cap).toContain("Rs 1,290")
    expect(cap).toContain("was Rs 1,990")
  })

  it("omits the was-price when compare <= price", () => {
    const cap = buildFeedCaption({ ...snap, compare_at_price_mur: 1290 })
    expect(cap).not.toContain("was Rs")
  })
})
