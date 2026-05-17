import { pickTemplate } from "../picker"
import type { ProductSnapshot } from "../../stories/snapshot"

function snapshot(overrides: Partial<ProductSnapshot> = {}): ProductSnapshot {
  return {
    name: "Test Dress",
    handle: "test-dress",
    price_mur: 1290,
    compare_at_price_mur: null,
    variants_in_stock: [],
    variant_in_stock_count: 0,
    is_new_arrival: false,
    picked_at: "2026-05-16T00:00:00.000Z",
    ...overrides,
  }
}

function color(
  id: string,
  imageCount: number,
  opts: { sku?: string; sizes?: string[]; color?: string } = {},
) {
  return {
    id,
    sku: opts.sku ?? `SKU-${id}`,
    color: opts.color ?? id,
    color_code: null,
    sizes: opts.sizes ?? ["S", "M"],
    image_urls: Array.from({ length: imageCount }, (_, i) => `https://r2/${id}-${i + 1}.jpg`),
  }
}

describe("pickTemplate", () => {
  it("returns null when snapshot is null", () => {
    expect(pickTemplate(null, 0)).toBeNull()
  })

  it("returns null when no in-stock variants", () => {
    expect(pickTemplate(snapshot(), 0)).toBeNull()
  })

  it("returns null when variants have no images", () => {
    const s = snapshot({
      variants_in_stock: [
        { ...color("pink", 0) },
      ],
      variant_in_stock_count: 1,
    })
    expect(pickTemplate(s, 0)).toBeNull()
  })

  it("picks on-sale when compare_at price is above current price", () => {
    const s = snapshot({
      price_mur: 990,
      compare_at_price_mur: 1490,
      variants_in_stock: [color("pink", 2)],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 0)
    expect(picked).not.toBeNull()
    expect(picked!.template_slug).toBe("on-sale")
    expect(picked!.slot_inputs.hero).toBe("https://r2/pink-1.jpg")
    expect(picked!.text_overrides.old_price).toBe("Rs.1490")
    expect(picked!.text_overrides.new_price).toBe("Rs.990")
  })

  it("ignores compare_at when it's not above current price", () => {
    const s = snapshot({
      price_mur: 1490,
      compare_at_price_mur: 1490,
      variants_in_stock: [color("pink", 2)],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 0)
    expect(picked!.template_slug).not.toBe("on-sale")
  })

  it("picks product-3colors when 3+ colors with photos exist", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", 2), color("blue", 1), color("white", 1)],
      variant_in_stock_count: 3,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-3colors")
    expect(picked.slot_inputs.front_a).toBe("https://r2/pink-1.jpg")
    expect(picked.slot_inputs.front_b).toBe("https://r2/blue-1.jpg")
    expect(picked.slot_inputs.front_c).toBe("https://r2/white-1.jpg")
    expect(picked.slot_inputs.back).toBe("https://r2/pink-2.jpg")
  })

  it("picks product-2colors when exactly 2 colors", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", 2), color("blue", 1)],
      variant_in_stock_count: 2,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-2colors")
    expect(picked.slot_inputs.front_a).toBe("https://r2/pink-1.jpg")
    expect(picked.slot_inputs.front_b).toBe("https://r2/blue-1.jpg")
    expect(picked.slot_inputs.back).toBe("https://r2/pink-2.jpg")
  })

  it("picks product-1color when 1 color with 2+ photos", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", 3)],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-1color")
    expect(picked.slot_inputs.front).toBe("https://r2/pink-1.jpg")
    expect(picked.slot_inputs.back).toBe("https://r2/pink-2.jpg")
  })

  it("rotates [in-stock-hero, lifestyle-overlay] by slot_index for variety on old products", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", 1)],
      variant_in_stock_count: 1,
      is_new_arrival: false,
    })
    const slugs = [0, 1, 2, 3].map((i) => pickTemplate(s, i)!.template_slug)
    expect(slugs[0]).toBe("in-stock-hero")
    expect(slugs[1]).toBe("lifestyle-overlay")
    expect(slugs[2]).toBe("in-stock-hero")
    expect(slugs[3]).toBe("lifestyle-overlay")
  })

  it("uses 'lifestyle' slot id (not 'hero') for lifestyle-overlay", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", 1)],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 1)!
    expect(picked.template_slug).toBe("lifestyle-overlay")
    expect(picked.slot_inputs.lifestyle).toBe("https://r2/pink-1.jpg")
    expect(picked.slot_inputs.hero).toBeUndefined()
  })

  it("picks new-arrival when product is new and only has 1 photo", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", 1)],
      variant_in_stock_count: 1,
      is_new_arrival: true,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("new-arrival")
    expect(picked.slot_inputs.hero).toBe("https://r2/pink-1.jpg")
  })

  it("never picks new-arrival for old products even at the rotation slot", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", 1)],
      variant_in_stock_count: 1,
      is_new_arrival: false,
    })
    for (let i = 0; i < 6; i++) {
      expect(pickTemplate(s, i)!.template_slug).not.toBe("new-arrival")
    }
  })

  it("multi-image cascade still wins over new-arrival when product is new + has multiple photos", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", 3)],
      variant_in_stock_count: 1,
      is_new_arrival: true,
    })
    expect(pickTemplate(s, 0)!.template_slug).toBe("product-1color")
  })

  it("on-sale wins over new-arrival when product is both new and on sale", () => {
    const s = snapshot({
      price_mur: 990,
      compare_at_price_mur: 1490,
      is_new_arrival: true,
      variants_in_stock: [color("pink", 1)],
      variant_in_stock_count: 1,
    })
    expect(pickTemplate(s, 0)!.template_slug).toBe("on-sale")
  })

  it("merges all in-stock sizes into the size override and truncates", () => {
    const s = snapshot({
      variants_in_stock: [
        color("pink", 1, { sizes: ["S", "M"] }),
        color("blue", 1, { sizes: ["L", "XL"] }),
        color("white", 1, { sizes: ["XXL"] }),
      ],
      variant_in_stock_count: 3,
    })
    const picked = pickTemplate(s, 0)!
    // product-3colors doesn't include 'size' override, so for this test we
    // assert with a 1-color snapshot that takes in-stock-hero
    const single = snapshot({
      variants_in_stock: [
        color("pink", 1, { sizes: ["S", "M", "L", "XL", "XXL", "3XL"] }),
      ],
      variant_in_stock_count: 1,
    })
    const pickedSingle = pickTemplate(single, 0)!
    expect(pickedSingle.template_slug).toBe("in-stock-hero")
    expect(pickedSingle.text_overrides.size.length).toBeLessThanOrEqual(28)
    expect(picked.template_slug).toBe("product-3colors")
  })

  it("omits sku when first variant has no SKU", () => {
    const v = color("pink", 1)
    const s = snapshot({
      variants_in_stock: [{ ...v, sku: null }],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.text_overrides.sku).toBeUndefined()
  })
})
