import { pickTemplate } from "../picker"
import type { ProductSnapshot, SnapshotVariant } from "../../stories/snapshot"

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

/**
 * imageSpec values map to filename suffixes via the boutique's convention:
 *   "front"      → https://r2/{id}.jpg          (no suffix)
 *   "back"       → https://r2/{id}-b.jpg
 *   "real"       → https://r2/{id}-r.jpg
 *   "detail"     → https://r2/{id}-1.jpg
 *   "size_chart" → https://r2/{id}-s.jpg
 *   "cutout"     → https://r2/{id}-cutout.png   (transparent-bg)
 *   "other"      → https://r2/{id}-2.jpg        (numbered = "other")
 */
function color(
  id: string,
  imageSpec: Array<"front" | "back" | "real" | "detail" | "size_chart" | "cutout" | "other">,
  opts: { sku?: string; sizes?: string[]; color?: string } = {},
): SnapshotVariant {
  const suffix: Record<string, { tail: string; ext: string }> = {
    front: { tail: "", ext: "jpg" },
    back: { tail: "-b", ext: "jpg" },
    real: { tail: "-r", ext: "jpg" },
    detail: { tail: "-1", ext: "jpg" },
    size_chart: { tail: "-s", ext: "jpg" },
    cutout: { tail: "-cutout", ext: "png" },
    other: { tail: "-2", ext: "jpg" },
  }
  return {
    id,
    sku: opts.sku ?? `SKU-${id}`,
    color: opts.color ?? id,
    color_code: null,
    sizes: opts.sizes ?? ["S", "M"],
    image_urls: imageSpec.map((k) => `https://r2/${id}${suffix[k].tail}.${suffix[k].ext}`),
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
      variants_in_stock: [color("pink", [])],
      variant_in_stock_count: 1,
    })
    expect(pickTemplate(s, 0)).toBeNull()
  })

  it("picks on-sale when compare_at price is above current price", () => {
    const s = snapshot({
      price_mur: 990,
      compare_at_price_mur: 1490,
      variants_in_stock: [color("pink", ["front", "back"])],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 0)
    expect(picked).not.toBeNull()
    expect(picked!.template_slug).toBe("on-sale")
    expect(picked!.slot_inputs.hero).toBe("https://r2/pink.jpg")
    expect(picked!.text_overrides.old_price).toBe("Rs.1490")
    expect(picked!.text_overrides.new_price).toBe("Rs.990")
  })

  it("ignores compare_at when it's not above current price", () => {
    const s = snapshot({
      price_mur: 1490,
      compare_at_price_mur: 1490,
      variants_in_stock: [color("pink", ["front", "back"])],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 0)
    expect(picked!.template_slug).not.toBe("on-sale")
  })

  it("picks product-3colors when 3+ colors with photos exist, back comes from a clean -b shot", () => {
    const s = snapshot({
      variants_in_stock: [
        color("pink", ["front", "back"]),
        color("blue", ["front"]),
        color("white", ["front"]),
      ],
      variant_in_stock_count: 3,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-3colors")
    expect(picked.slot_inputs.front_a).toBe("https://r2/pink.jpg")
    expect(picked.slot_inputs.front_b).toBe("https://r2/blue.jpg")
    expect(picked.slot_inputs.front_c).toBe("https://r2/white.jpg")
    expect(picked.slot_inputs.back).toBe("https://r2/pink-b.jpg")
  })

  it("picks product-2colors when exactly 2 colors, back is the clean -b shot", () => {
    const s = snapshot({
      variants_in_stock: [
        color("pink", ["front", "back"]),
        color("blue", ["front"]),
      ],
      variant_in_stock_count: 2,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-2colors")
    expect(picked.slot_inputs.front_a).toBe("https://r2/pink.jpg")
    expect(picked.slot_inputs.front_b).toBe("https://r2/blue.jpg")
    expect(picked.slot_inputs.back).toBe("https://r2/pink-b.jpg")
  })

  it("REGRESSION: product-2colors never uses an -r (real/on-model) shot as the back slot", () => {
    // This is the exact bug: variant images are [front, real, back] and the
    // old picker took image_urls[1] (real) as the back. The new picker MUST
    // grab the -b file regardless of array position.
    const s = snapshot({
      variants_in_stock: [
        color("pink", ["front", "real", "back"]),
        color("blue", ["front"]),
      ],
      variant_in_stock_count: 2,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-2colors")
    expect(picked.slot_inputs.back).toBe("https://r2/pink-b.jpg")
    // critically, the back slot must NOT be the -r image
    expect(picked.slot_inputs.back).not.toBe("https://r2/pink-r.jpg")
  })

  it("REGRESSION: product-3colors never uses an -r shot as the back slot when a clean back exists elsewhere", () => {
    // First color has [front, real] (no back), second color has [front, back].
    // Old picker would have used pink's real shot via the index-1 lookup; new
    // picker must skip pink for back and pull blue's clean back instead.
    const s = snapshot({
      variants_in_stock: [
        color("pink", ["front", "real"]),
        color("blue", ["front", "back"]),
        color("white", ["front"]),
      ],
      variant_in_stock_count: 3,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-3colors")
    expect(picked.slot_inputs.back).toBe("https://r2/blue-b.jpg")
    expect(picked.slot_inputs.back).not.toBe("https://r2/pink-r.jpg")
  })

  it("falls back to single-image template when 2 colors exist but no color has a clean back", () => {
    // 2 colors, each only has a front and a real shot. There's no usable back
    // anywhere → product-2colors must be skipped, fall back to the single-image
    // rotation rather than push a real shot through.
    const s = snapshot({
      variants_in_stock: [
        color("pink", ["front", "real"]),
        color("blue", ["front", "real"]),
      ],
      variant_in_stock_count: 2,
    })
    const picked = pickTemplate(s, 0)!
    expect(["in-stock-hero", "lifestyle-overlay"]).toContain(picked.template_slug)
    // hero/lifestyle must be a clean front, never a real shot
    const value = picked.slot_inputs.hero ?? picked.slot_inputs.lifestyle
    expect(value).toBe("https://r2/pink.jpg")
  })

  it("picks product-1color when 1 color with front + back", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", ["front", "back"])],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-1color")
    expect(picked.slot_inputs.front).toBe("https://r2/pink.jpg")
    expect(picked.slot_inputs.back).toBe("https://r2/pink-b.jpg")
  })

  it("REGRESSION: product-1color is NOT used when the only second image is a detail/real/size_chart shot", () => {
    // Variant has [front, detail]. Old code did `image_urls.length >= 2` and
    // happily used "-1" (detail) as the back. New picker must fall through.
    const s = snapshot({
      variants_in_stock: [color("pink", ["front", "detail"])],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).not.toBe("product-1color")
    expect(["in-stock-hero", "lifestyle-overlay", "new-arrival"]).toContain(
      picked.template_slug,
    )
  })

  it("rotates [in-stock-hero, lifestyle-overlay] by slot_index for variety on old products", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", ["front"])],
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
      variants_in_stock: [color("pink", ["front"])],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 1)!
    expect(picked.template_slug).toBe("lifestyle-overlay")
    expect(picked.slot_inputs.lifestyle).toBe("https://r2/pink.jpg")
    expect(picked.slot_inputs.hero).toBeUndefined()
  })

  it("lifestyle-overlay prefers a real/on-model shot when one exists", () => {
    // Per handoff: lifestyle-overlay is the ONE template that's allowed to use
    // a -r real shot. The picker should plug that into the lifestyle slot.
    const s = snapshot({
      variants_in_stock: [color("pink", ["front", "real"])],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 1)!
    expect(picked.template_slug).toBe("lifestyle-overlay")
    expect(picked.slot_inputs.lifestyle).toBe("https://r2/pink-r.jpg")
  })

  it("lifestyle-overlay falls back to the front shot when there is no real shot", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", ["front"])],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 1)!
    expect(picked.template_slug).toBe("lifestyle-overlay")
    expect(picked.slot_inputs.lifestyle).toBe("https://r2/pink.jpg")
  })

  it("REGRESSION: product with ONLY real/detail/size_chart images is skipped entirely (returns null)", () => {
    // Newer-drop edge case. Don't post a real shot as a stock-style story just
    // because it's the only image available.
    const s = snapshot({
      variants_in_stock: [color("pink", ["real", "real", "detail"])],
      variant_in_stock_count: 1,
    })
    expect(pickTemplate(s, 0)).toBeNull()
    expect(pickTemplate(s, 1)).toBeNull()
  })

  it("DEFENSIVE: when first image of variant has no recognized role, treat as front (Medusa thumbnail convention)", () => {
    // Per handoff edge case 3: if classifier returns 'other' for image[0],
    // treat it as front (Medusa product image #1 is the catalog thumbnail).
    // "-2.jpg" classifies as 'other'.
    const s = snapshot({
      variants_in_stock: [color("pink", ["other", "back"])],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-1color")
    expect(picked.slot_inputs.front).toBe("https://r2/pink-2.jpg")
    expect(picked.slot_inputs.back).toBe("https://r2/pink-b.jpg")
  })

  it("picks new-arrival when product is new and only has 1 photo", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", ["front"])],
      variant_in_stock_count: 1,
      is_new_arrival: true,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("new-arrival")
    expect(picked.slot_inputs.hero).toBe("https://r2/pink.jpg")
  })

  it("never picks new-arrival for old products even at the rotation slot", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", ["front"])],
      variant_in_stock_count: 1,
      is_new_arrival: false,
    })
    for (let i = 0; i < 6; i++) {
      expect(pickTemplate(s, i)!.template_slug).not.toBe("new-arrival")
    }
  })

  it("multi-image cascade still wins over new-arrival when product is new + has multiple photos", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", ["front", "back", "real"])],
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
      variants_in_stock: [color("pink", ["front"])],
      variant_in_stock_count: 1,
    })
    expect(pickTemplate(s, 0)!.template_slug).toBe("on-sale")
  })

  it("merges all in-stock sizes into the size override and truncates", () => {
    const single = snapshot({
      variants_in_stock: [
        color("pink", ["front"], { sizes: ["S", "M", "L", "XL", "XXL", "3XL"] }),
      ],
      variant_in_stock_count: 1,
    })
    const pickedSingle = pickTemplate(single, 0)!
    expect(pickedSingle.template_slug).toBe("in-stock-hero")
    expect(pickedSingle.text_overrides.size.length).toBeLessThanOrEqual(28)
  })

  it("omits sku when first variant has no SKU", () => {
    const v = color("pink", ["front"])
    const s = snapshot({
      variants_in_stock: [{ ...v, sku: null }],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.text_overrides.sku).toBeUndefined()
  })

  describe("cutout-spotlight integration", () => {
    it("picks cutout-spotlight when a variant has a -cutout PNG and product is single-color, single-image", () => {
      // Single color, one front + one cutout: replaces in-stock-hero in the
      // rotation so we get the editorial spotlight style instead of a plain
      // catalog photo.
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
      })
      const picked = pickTemplate(s, 0)!
      expect(picked.template_slug).toBe("cutout-spotlight")
      expect(picked.slot_inputs.product_cutout).toBe("https://r2/pink-cutout.png")
    })

    it("cutout-spotlight wins over both in-stock-hero AND lifestyle-overlay across slot indices", () => {
      // The rotation pool used to alternate in-stock-hero / lifestyle by slot
      // index. When a cutout exists, both slots should pick cutout-spotlight —
      // it's the more polished editorial template.
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
      })
      for (let i = 0; i < 4; i++) {
        expect(pickTemplate(s, i)!.template_slug).toBe("cutout-spotlight")
      }
    })

    it("multi-color cascade still wins over cutout-spotlight (cutout is single-product editorial only)", () => {
      // 2 colors with backs → product-2colors is the right call. The cutout
      // template is for solo-product editorial moments, not multi-color carousels.
      const s = snapshot({
        variants_in_stock: [
          color("pink", ["front", "back", "cutout"]),
          color("blue", ["front", "back"]),
        ],
        variant_in_stock_count: 2,
      })
      expect(pickTemplate(s, 0)!.template_slug).toBe("product-2colors")
    })

    it("on-sale still wins over cutout-spotlight", () => {
      const s = snapshot({
        price_mur: 990,
        compare_at_price_mur: 1490,
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
      })
      expect(pickTemplate(s, 0)!.template_slug).toBe("on-sale")
    })

    it("new-arrival still wins over cutout-spotlight for fresh products", () => {
      // New arrival is the rarest signal; preserve it when set so the NEW
      // stamp doesn't get hidden behind a cutout shot.
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
        is_new_arrival: true,
      })
      expect(pickTemplate(s, 0)!.template_slug).toBe("new-arrival")
    })

    it("cutout PNG never plugs into product-1color front/back slots", () => {
      // -cutout isn't a "back" — front + cutout shouldn't trigger product-1color.
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
      })
      const picked = pickTemplate(s, 0)!
      expect(picked.template_slug).not.toBe("product-1color")
      expect(picked.slot_inputs.back).toBeUndefined()
    })

    it("falls back to in-stock-hero rotation when product has front but NO cutout", () => {
      const s = snapshot({
        variants_in_stock: [color("pink", ["front"])],
        variant_in_stock_count: 1,
        is_new_arrival: false,
      })
      const slugs = [0, 1].map((i) => pickTemplate(s, i)!.template_slug)
      expect(slugs).toEqual(["in-stock-hero", "lifestyle-overlay"])
    })

    it("cutout-spotlight is suppressed when a -r real shot exists (lifestyle wins)", () => {
      // Product has both a cutout AND a real shot. The new rule (2026-05-19):
      // real-shot products are stronger as lifestyle-overlay, so cutout is
      // reserved for studio-only products with no real photography.
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "real", "cutout"])],
        variant_in_stock_count: 1,
      })
      const slugs = [0, 1].map((i) => pickTemplate(s, i)!.template_slug)
      expect(slugs).toEqual(["in-stock-hero", "lifestyle-overlay"])
    })

    it("cutout-spotlight still fires when product has cutout but NO real shot", () => {
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
      })
      expect(pickTemplate(s, 0)!.template_slug).toBe("cutout-spotlight")
    })
  })
})
