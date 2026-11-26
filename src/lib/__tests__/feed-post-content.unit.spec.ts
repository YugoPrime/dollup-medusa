import {
  buildFeedCaption,
  isRealPhoto,
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
  it("never takes the real photos, only the model and back shots", () => {
    const urls = selectFeedImages({
      variants_in_stock: [
        {
          ...snap.variants_in_stock[0],
          image_urls: [
            "https://cdn.dollupboutique.com/IS2454-black-01M87JJZ63RE3HSZ2PAN6829HP.jpg",
            "https://cdn.dollupboutique.com/IS2454-black-b-01M87JK03EB3343V5X6SWST03V.jpg",
            "https://cdn.dollupboutique.com/IS2454-Black-r-01M8AA4DM7SV0XW6NJBM3KK4DD.jpg",
          ],
        },
      ],
    })
    expect(urls).toEqual([
      "https://cdn.dollupboutique.com/IS2454-black-01M87JJZ63RE3HSZ2PAN6829HP.jpg",
      "https://cdn.dollupboutique.com/IS2454-black-b-01M87JK03EB3343V5X6SWST03V.jpg",
    ])
  })

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

  // Publishing converts every photo to JPEG (feed-image-prep), so a product's
  // PNG/WebP photos must not be dropped just because one JPEG exists.
  it("keeps PNG and WebP photos next to JPEGs, in upload order", () => {
    const mixed: typeof snap = {
      ...snap,
      variants_in_stock: [
        {
          id: "v",
          sku: "X",
          color: "Red",
          color_code: null,
          sizes: ["S"],
          image_urls: ["https://cdn/x-front.png", "https://cdn/x-back.jpeg", "https://cdn/x-side.webp"],
        },
      ],
    }
    expect(selectFeedImages(mixed)).toEqual([
      "https://cdn/x-front.png",
      "https://cdn/x-back.jpeg",
      "https://cdn/x-side.webp",
    ])
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

describe("isRealPhoto (Rahvi, 26 Nov: the real photos are never posted)", () => {
  it("spots the real photos, as uploaded (name + upload id) or by their bare name", () => {
    for (const url of [
      "https://cdn.dollupboutique.com/IS2454-Black-r-01M8AA4DM7SV0XW6NJBM3KK4DD.jpg",
      "https://cdn.dollupboutique.com/IS2454-Red-rr-01M8AA4EGD0MVWJHZSFS7SJAVT.jpg",
      "https://cdn.dollupboutique.com/IS2454-Red-rrr-01M8AA4EGD0MVWJHZSFS7SJAVT.JPG",
      "https://cdn/is1587-r.jpg",
      "https://cdn/is2448-pink-real.jpg",
      "https://cdn/is2448-pink-real-01M8AA4DM7SV0XW6NJBM3KK4DD.webp?v=2",
    ]) {
      expect(isRealPhoto(url)).toBe(true)
    }
  })

  it("leaves the model, back and plain shots alone", () => {
    for (const url of [
      "https://cdn.dollupboutique.com/IS2454-black-01M87JJZ63RE3HSZ2PAN6829HP.jpg",
      "https://cdn.dollupboutique.com/IS2454-black-b-01M87JK03EB3343V5X6SWST03V.jpg",
      "https://cdn.dollupboutique.com/IS2450-Rose-Red-01M87JJZ63RE3HSZ2PAN6829HP.jpg",
      "https://cdn/is2448-pink-front.jpg",
      "https://cdn/is2497.jpg",
      "",
    ]) {
      expect(isRealPhoto(url)).toBe(false)
    }
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

  it("default caption links to the live storefront and never promises COD", () => {
    const cap = buildFeedCaption(snap)
    expect(cap).toContain("🔗 https://dollupboutique.com/products/is2448")
    expect(cap).toContain("🚚 Fast island-wide delivery")
    expect(cap).not.toContain("Cash on delivery")
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

  it("lists the sizes from small to large", () => {
    const cap = buildFeedCaption({
      ...snap,
      variants_in_stock: [{ ...snap.variants_in_stock[0], sizes: ["S", "M", "L", "XS"] }],
    })
    expect(cap).toContain("📏 Sizes: XS · S · M · L")
  })
})
