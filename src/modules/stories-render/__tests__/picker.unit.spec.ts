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
    // Auto-computed discount % — floor((1490-990)/1490 * 100) = 33%
    expect(picked!.text_overrides.discount_pct).toBe("-33%")
  })

  it("on-sale discount_pct is floored so we never overstate the discount", () => {
    const s = snapshot({
      price_mur: 999,
      compare_at_price_mur: 1490, // floor((1490-999)/1490 * 100) = 32
      variants_in_stock: [color("pink", ["front", "back"])],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("on-sale")
    expect(picked.text_overrides.discount_pct).toBe("-32%")
  })

  it("on-sale omits discount_pct when there is no real saving", () => {
    // Edge: compare_at equals price → no saving → on-sale isn't picked anyway,
    // but if a future change ever lets it through, the % should be undefined,
    // never "-0%". Force it via direct buildTextOverrides path: easier to test
    // by setting compare_at JUST above price so on-sale fires but the floor
    // produces 0.
    const s = snapshot({
      price_mur: 1490,
      compare_at_price_mur: 1500, // floor(10/1500*100) = 0 → omit
      variants_in_stock: [color("pink", ["front", "back"])],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("on-sale")
    expect(picked.text_overrides.discount_pct).toBeUndefined()
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

  it("picks product-2colors-front when 2 colors exist but no color has a clean back", () => {
    // 2 colors, each with a front + real shot but NO back. Real cannot be used
    // as a back slot, so product-2colors is skipped. New behaviour (2026-05-19):
    // promote to product-2colors-front instead of falling all the way down to
    // single-image rotation — surfaces both colors so the customer sees the
    // available range.
    const s = snapshot({
      variants_in_stock: [
        color("pink", ["front", "real"]),
        color("blue", ["front", "real"]),
      ],
      variant_in_stock_count: 2,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-2colors-front")
    expect(picked.slot_inputs.front_a).toBe("https://r2/pink.jpg")
    expect(picked.slot_inputs.front_b).toBe("https://r2/blue.jpg")
    // back slot must NOT be populated — that's the whole point of the variant
    expect(picked.slot_inputs.back).toBeUndefined()
  })

  it("product-2colors (with back) still wins over product-2colors-front when a back is available", () => {
    const s = snapshot({
      variants_in_stock: [
        color("pink", ["front", "back"]),
        color("blue", ["front"]),
      ],
      variant_in_stock_count: 2,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-2colors")
    expect(picked.slot_inputs.back).toBe("https://r2/pink-b.jpg")
  })

  it("product-2colors populates per-color size_a / size_b and OMITS the global size", () => {
    const s = snapshot({
      variants_in_stock: [
        color("pink", ["front", "back"], { sizes: ["S", "M"] }),
        color("blue", ["front", "back"], { sizes: ["S", "M", "L"] }),
      ],
      variant_in_stock_count: 2,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-2colors")
    expect(picked.text_overrides.size_a).toBe("S · M")
    expect(picked.text_overrides.size_b).toBe("S · M · L")
    // Global `size` is intentionally NOT set on multi-color templates anymore
    // — sizes are surfaced per color so we never imply a size is available
    // in a color that doesn't stock it.
    expect(picked.text_overrides.size).toBeUndefined()
  })

  it("product-2colors-front populates per-color size_a / size_b on the wipe-reveal hero", () => {
    const s = snapshot({
      variants_in_stock: [
        color("pink", ["front"], { sizes: ["S", "M"] }),
        color("blue", ["front"], { sizes: ["L", "XL"] }),
      ],
      variant_in_stock_count: 2,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-2colors-front")
    expect(picked.text_overrides.size_a).toBe("S · M")
    expect(picked.text_overrides.size_b).toBe("L · XL")
    expect(picked.text_overrides.size).toBeUndefined()
  })

  it("product-3colors populates per-color size_a / size_b / size_c on the 2x2 grid", () => {
    const s = snapshot({
      variants_in_stock: [
        color("pink", ["front", "back"], { sizes: ["S", "M"] }),
        color("blue", ["front"], { sizes: ["M", "L"] }),
        color("cream", ["front"], { sizes: ["S", "M", "L", "XL"] }),
      ],
      variant_in_stock_count: 3,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-3colors")
    expect(picked.text_overrides.size_a).toBe("S · M")
    expect(picked.text_overrides.size_b).toBe("M · L")
    expect(picked.text_overrides.size_c).toBe("S · M · L · XL")
    expect(picked.text_overrides.size).toBeUndefined()
  })

  it("color-mood-rail also populates per-color size_a / size_b / size_c", () => {
    const s = snapshot({
      variants_in_stock: [
        color("pink", ["front"], { sizes: ["S", "M"] }),
        color("blue", ["front"], { sizes: ["L"] }),
        color("cream", ["front"], { sizes: ["M", "L"] }),
      ],
      variant_in_stock_count: 3,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("color-mood-rail")
    expect(picked.text_overrides.size_a).toBe("S · M")
    expect(picked.text_overrides.size_b).toBe("L")
    expect(picked.text_overrides.size_c).toBe("M · L")
    expect(picked.text_overrides.size).toBeUndefined()
  })

  it("per-color size_a shows 'One size' when that color has no size variants", () => {
    const s = snapshot({
      variants_in_stock: [
        color("pink", ["front", "back"], { sizes: [] }),
        color("blue", ["front", "back"], { sizes: ["S", "M"] }),
      ],
      variant_in_stock_count: 2,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-2colors")
    expect(picked.text_overrides.size_a).toBe("One size")
    expect(picked.text_overrides.size_b).toBe("S · M")
  })

  it("product-2colors-front is skipped when a color has no clean front (e.g. only real shots)", () => {
    // Second color only has a real shot. pickFront returns null for it, so
    // the 2-color cascade can't fire either with or without back. Falls
    // through to single-image rotation using the first color's front.
    const s = snapshot({
      variants_in_stock: [
        color("pink", ["front"]),
        color("blue", ["real"]),
      ],
      variant_in_stock_count: 2,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).not.toBe("product-2colors-front")
    expect(picked.template_slug).not.toBe("product-2colors")
  })

  it("picks product-1color (or featured variant) when 1 color with front + back", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", ["front", "back"])],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 0)!
    expect(["product-1color", "product-1color-featured"]).toContain(
      picked.template_slug,
    )
    expect(picked.slot_inputs.front).toBe("https://r2/pink.jpg")
    expect(picked.slot_inputs.back).toBe("https://r2/pink-b.jpg")
  })

  it("product-1color populates size text override with · separator", () => {
    const s = snapshot({
      variants_in_stock: [
        color("pink", ["front", "back"], { sizes: ["S", "M", "L"] }),
      ],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-1color")
    expect(picked.text_overrides.size).toBe("Size: S · M · L")
  })

  it("product-1color size collapses to 'One size' when product has no sized variants", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", ["front", "back"], { sizes: [] })],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 0)!
    expect(picked.template_slug).toBe("product-1color")
    expect(picked.text_overrides.size).toBe("One size")
  })

  it("rotates the 15-template 1-color pool by slot_index for 1-color front+back", () => {
    // 15-template pool (2026-05-25: original 3 layouts × 4 palette siblings
    // each, plus the 3 originals). Without a count map, picker rotates by
    // slotIndex mod 15 for deterministic test behavior. Order follows
    // ONE_COLOR_FRONT_BACK_ROTATION exactly.
    const s = snapshot({
      variants_in_stock: [color("pink", ["front", "back"])],
      variant_in_stock_count: 1,
    })
    expect(pickTemplate(s, 0)!.template_slug).toBe("product-1color")
    expect(pickTemplate(s, 1)!.template_slug).toBe("product-1color-blush")
    expect(pickTemplate(s, 5)!.template_slug).toBe("product-1color-featured")
    expect(pickTemplate(s, 10)!.template_slug).toBe("new-drop-arch")
    // Wrap-around: slot 15 == slot 0.
    expect(pickTemplate(s, 15)!.template_slug).toBe("product-1color")
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
    expect(picked.template_slug).not.toBe("product-1color-featured")
    expect(["in-stock-hero", "lifestyle-overlay", "new-arrival"]).toContain(
      picked.template_slug,
    )
  })

  it("rotates the single-image pool by slot_index", () => {
    // 9-template rotation (2026-05-30: added the four 1-color editorial slugs —
    // editorial-cover-hero + split-thirds-editorial + receipt-tag-1color +
    // framed-gallery-1color). All accept the same `hero` (or `lifestyle`) slot
    // from a single front shot. Order: ink → blush → lifestyle → cream →
    // just-arrived → editorial-cover → split-thirds → receipt-tag → framed →
    // repeat.
    const s = snapshot({
      variants_in_stock: [color("pink", ["front"])],
      variant_in_stock_count: 1,
      is_new_arrival: false,
    })
    const slugs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(
      (i) => pickTemplate(s, i)!.template_slug,
    )
    expect(slugs).toEqual([
      "in-stock-hero",
      "in-stock-hero-blush",
      "lifestyle-overlay",
      "in-stock-hero-cream",
      "just-arrived-editorial",
      "editorial-cover-hero",
      "split-thirds-editorial",
      "receipt-tag-1color",
      "framed-gallery-1color",
      "in-stock-hero",
      "in-stock-hero-blush",
    ])
  })

  it("in-stock-hero variants use the 'hero' slot like the base template", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", ["front"])],
      variant_in_stock_count: 1,
    })
    // Slot 1 → blush, slot 3 → cream. Both must plug into "hero".
    const blush = pickTemplate(s, 1)!
    expect(blush.template_slug).toBe("in-stock-hero-blush")
    expect(blush.slot_inputs.hero).toBe("https://r2/pink.jpg")

    const cream = pickTemplate(s, 3)!
    expect(cream.template_slug).toBe("in-stock-hero-cream")
    expect(cream.slot_inputs.hero).toBe("https://r2/pink.jpg")
  })

  it("uses 'lifestyle' slot id (not 'hero') for lifestyle-overlay", () => {
    // lifestyle-overlay is at rotation index 2 now (rotation expanded with
    // blush + cream variants in between in-stock-hero and lifestyle).
    const s = snapshot({
      variants_in_stock: [color("pink", ["front"])],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 2)!
    expect(picked.template_slug).toBe("lifestyle-overlay")
    expect(picked.slot_inputs.lifestyle).toBe("https://r2/pink.jpg")
    expect(picked.slot_inputs.hero).toBeUndefined()
  })

  it("lifestyle-overlay NEVER uses a real/-r shot (boutique policy 2026-05-19)", () => {
    // Even when a -r real shot is available, the picker must plug the clean
    // front into the lifestyle slot. The template's distinctive look comes
    // from its typography/gradient overlay, not the underlying photo kind.
    const s = snapshot({
      variants_in_stock: [color("pink", ["front", "real"])],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 2)!
    expect(picked.template_slug).toBe("lifestyle-overlay")
    expect(picked.slot_inputs.lifestyle).toBe("https://r2/pink.jpg")
    expect(picked.slot_inputs.lifestyle).not.toBe("https://r2/pink-r.jpg")
  })

  it("lifestyle-overlay falls back to the front shot when there is no real shot", () => {
    const s = snapshot({
      variants_in_stock: [color("pink", ["front"])],
      variant_in_stock_count: 1,
    })
    const picked = pickTemplate(s, 2)!
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
    it("cutout-spotlight participates in the rotation when a -cutout PNG is available (single-color, single-image product)", () => {
      // A cutout adds cutout-spotlight to the rotation pool. The picker still
      // alternates with the hero / lifestyle variants by slot_index to keep
      // the daily feed visually varied. The "always wins" behaviour from the
      // initial rollout caused every story to look identical once 234
      // products had cutouts uploaded.
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
      })
      const slugsOver10Slots = Array.from({ length: 10 }, (_, i) =>
        pickTemplate(s, i)!.template_slug,
      )
      expect(slugsOver10Slots).toContain("cutout-spotlight")
      expect(slugsOver10Slots).toContain("in-stock-hero")
      expect(slugsOver10Slots).toContain("lifestyle-overlay")
    })

    it("cutout-spotlight + cutout-spotlight-v2 are the last two entries in the 11-template single-image rotation when a cutout exists", () => {
      // 2026-05-19: cutout-spotlight stopped winning unconditionally and joined
      // the rotation alongside the hero variants.
      // 2026-05-21: just-arrived-editorial added to the rotation.
      // 2026-05-22: cutout-spotlight-v2 added (bold blush circle + italic-script
      // typography variant).
      // 2026-05-30: four 1-color editorial slugs added to the base rotation
      // (editorial-cover-hero, split-thirds-editorial, receipt-tag-1color,
      // framed-gallery-1color). Cutout-enabled pool is now 11: base 9 + cutout
      // v1 + cutout v2, with the two cutouts still the final two entries.
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
      })
      const slugs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(
        (i) => pickTemplate(s, i)!.template_slug,
      )
      expect(slugs).toEqual([
        "in-stock-hero",
        "in-stock-hero-blush",
        "lifestyle-overlay",
        "in-stock-hero-cream",
        "just-arrived-editorial",
        "editorial-cover-hero",
        "split-thirds-editorial",
        "receipt-tag-1color",
        "framed-gallery-1color",
        "cutout-spotlight",
        "cutout-spotlight-v2",
      ])
    })

    it("cutout-spotlight-v2 lands at slot index 10 with the cutout PNG in product_cutout", () => {
      // Slot 10 is the 11th (last) item in the cutout-enabled rotation pool —
      // that's the v2 layout (bold blush circle + script typography). Same slot
      // contract as v1 so the picker can route either way.
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
      })
      const picked = pickTemplate(s, 10)!
      expect(picked.template_slug).toBe("cutout-spotlight-v2")
      expect(picked.slot_inputs.product_cutout).toBe("https://r2/pink-cutout.png")
    })

    it("cutout-spotlight slot_inputs.product_cutout is the -cutout PNG URL when the rotation lands on it", () => {
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
      })
      // slotIndex 9 lands on cutout-spotlight per the 11-template rotation above.
      const picked = pickTemplate(s, 9)!
      expect(picked.template_slug).toBe("cutout-spotlight")
      expect(picked.slot_inputs.product_cutout).toBe("https://r2/pink-cutout.png")
    })

    it("multi-color cascade always wins over cutout-spotlight (cutout is single-color only)", () => {
      // 2026-05-26 policy: cutout-spotlight is reserved for SINGLE-COLOR
      // products. Multi-color products with a cutout PNG still use their
      // native multi-color template (product-2colors / 3colors / etc).
      // The daily guarantee at the top of pickTemplate respects this.
      const s = snapshot({
        variants_in_stock: [
          color("pink", ["front", "back", "cutout"]),
          color("blue", ["front", "back"]),
        ],
        variant_in_stock_count: 2,
      })
      expect(pickTemplate(s, 0)!.template_slug).toBe("product-2colors")
    })

    it("on-sale wins over cutout-spotlight when NO per-day count map is passed (back-compat)", () => {
      // When the count map IS passed (production batch render), the 2026-05-26
      // daily guarantee promotes cutout ABOVE on-sale on the first eligible
      // slot — see the "wins over on-sale and new-arrival" test below.
      const s = snapshot({
        price_mur: 990,
        compare_at_price_mur: 1490,
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
      })
      expect(pickTemplate(s, 0)!.template_slug).toBe("on-sale")
    })

    it("new-arrival wins over cutout-spotlight when NO per-day count map is passed (back-compat)", () => {
      // Same caveat as on-sale above: this is the count-map-free path. With
      // a count map, the daily guarantee fires before new-arrival can match.
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
        is_new_arrival: true,
      })
      expect(pickTemplate(s, 0)!.template_slug).toBe("new-arrival")
    })

    it("cutout PNG never plugs into a front+back product template", () => {
      // -cutout isn't a "back" — front + cutout shouldn't trigger any of the
      // 3 templates in ONE_COLOR_FRONT_BACK_ROTATION (product-1color,
      // product-1color-featured, new-drop-arch).
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
      })
      const picked = pickTemplate(s, 0)!
      expect(picked.template_slug).not.toBe("product-1color")
      expect(picked.template_slug).not.toBe("product-1color-featured")
      expect(picked.template_slug).not.toBe("new-drop-arch")
      expect(picked.slot_inputs.back).toBeUndefined()
    })

    it("falls back to in-stock-hero rotation when product has front but NO cutout", () => {
      const s = snapshot({
        variants_in_stock: [color("pink", ["front"])],
        variant_in_stock_count: 1,
        is_new_arrival: false,
      })
      const slugs = [0, 1, 2, 3].map((i) => pickTemplate(s, i)!.template_slug)
      expect(slugs).toEqual([
        "in-stock-hero",
        "in-stock-hero-blush",
        "lifestyle-overlay",
        "in-stock-hero-cream",
      ])
    })

    it("cutout-spotlight is eligible even when a -r real shot exists", () => {
      // Until 2026-05-25 the picker suppressed cutout-spotlight whenever a
      // real shot was present. That gate is gone — no template uses real
      // shots anymore (2026-05-19 policy), so the original "real wins as
      // lifestyle" rationale died. Cutout now joins the rotation pool
      // whenever a cutout PNG exists, regardless of whether a real shot
      // also exists. Slots 0..3 still resolve to the first four base
      // templates by deterministic index, but the daily-guarantee branch
      // (separate test below) will force cutout-spotlight on the first
      // slot of a plan that hasn't shipped one yet.
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "real", "cutout"])],
        variant_in_stock_count: 1,
      })
      const slugs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(
        (i) => pickTemplate(s, i)!.template_slug,
      )
      expect(slugs).toContain("cutout-spotlight")
      expect(slugs).toContain("cutout-spotlight-v2")
    })

    it("DAILY GUARANTEE fires for cutout+real products (post-2026-05-25 gate removal)", () => {
      // Regression guard for the 2026-05-25 fix. Before that, hasRealShot
      // blocked the daily guarantee whenever a -real upload existed, and
      // cutout-spotlight never appeared in published stories despite 239
      // cutout PNGs being uploaded to R2.
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "real", "cutout"])],
        variant_in_stock_count: 1,
      })
      const dayCounts = new Map<string, number>()
      const picked = pickTemplate(s, 0, dayCounts)!
      expect(picked.template_slug).toBe("cutout-spotlight")
    })

    it("cutout-spotlight still appears in the rotation when product has cutout but NO real shot", () => {
      // 2026-05-21: rotation grew from 5 to 6 entries with just-arrived-editorial.
      // 2026-05-30: base rotation grew to 9, so the cutout-enabled pool is 11.
      // Sample 11 slots to catch cutout-spotlight at index 9.
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
      })
      const slugs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(
        (i) => pickTemplate(s, i)!.template_slug,
      )
      expect(slugs).toContain("cutout-spotlight")
    })

    it("DAILY GUARANTEE: cutout-spotlight forced when product is cutout-eligible and no cutout has fired today", () => {
      // 2026-05-22: enforce at least one cutout per day so the daily feed
      // always surfaces the editorial cutout layout. Without this, cutout
      // was just 2/7 of the rotation and on most days zero cutouts shipped.
      // The guarantee only fires when a per-day count map is passed AND no
      // cutout has fired yet — so the first cutout-eligible slot of the day
      // is forced to cutout-spotlight, regardless of slot index.
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
      })
      const dayCounts = new Map<string, number>()
      // Slot 0 would normally pick "in-stock-hero" (first in rotation),
      // but the daily guarantee bumps it to cutout-spotlight instead.
      const picked = pickTemplate(s, 0, dayCounts)!
      expect(picked.template_slug).toBe("cutout-spotlight")
      expect(picked.slot_inputs.product_cutout).toBe("https://r2/pink-cutout.png")
    })

    it("DAILY GUARANTEE: only fires ONCE per day — second cutout-eligible slot falls back to rotation", () => {
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
      })
      // Simulate slot 0 already picked cutout-spotlight.
      const dayCounts = new Map<string, number>([["cutout-spotlight", 1]])
      const picked = pickTemplate(s, 1, dayCounts)!
      // Slot 1 should NOT be cutout-spotlight again (guarantee satisfied).
      expect(picked.template_slug).not.toBe("cutout-spotlight")
    })

    it("DAILY GUARANTEE: skipped when product has no cutout PNG (can't render what doesn't exist)", () => {
      const s = snapshot({
        variants_in_stock: [color("pink", ["front"])], // no cutout
        variant_in_stock_count: 1,
      })
      const dayCounts = new Map<string, number>()
      const picked = pickTemplate(s, 0, dayCounts)!
      // No cutout PNG → guarantee skipped, slot falls to normal rotation.
      expect(picked.template_slug).not.toBe("cutout-spotlight")
      expect(picked.template_slug).not.toBe("cutout-spotlight-v2")
    })

    it("DAILY GUARANTEE: counts both cutout-spotlight AND cutout-spotlight-v2 toward the daily quota", () => {
      // If v2 fires first, the guarantee for v1 is already satisfied —
      // we want AT LEAST one cutout, not specifically v1.
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "cutout"])],
        variant_in_stock_count: 1,
      })
      const dayCounts = new Map<string, number>([["cutout-spotlight-v2", 1]])
      const picked = pickTemplate(s, 1, dayCounts)!
      // V2 already fired → no guarantee bump → normal rotation picks.
      expect(picked.template_slug).not.toBe("cutout-spotlight")
      expect(picked.template_slug).not.toBe("cutout-spotlight-v2")
    })

    it("DAILY GUARANTEE 2026-05-26: SKIPPED for multi-color cutout-eligible products (single-color only)", () => {
      // Boutique policy 2026-05-26: cutout-spotlight is a single-product
      // editorial layout — multi-color products belong in product-2colors /
      // product-3colors / color-mood-rail. The guarantee MUST NOT hijack a
      // multi-color story to fire cutout, even though the cutout PNG exists.
      const s = snapshot({
        variants_in_stock: [
          { id: "red", sku: "IS2008-M-R", color: "Red", color_code: null, sizes: ["S", "M"], image_urls: ["https://r2/IS2008-red-front.jpg", "https://r2/IS2008-red-back.jpg", "https://r2/IS2008-cutout.png"] },
          { id: "blue", sku: "IS2008-M-B", color: "Blue", color_code: null, sizes: ["M"], image_urls: ["https://r2/IS2008-blue-front.jpg", "https://r2/IS2008-blue-back.jpg"] },
        ],
        variant_in_stock_count: 2,
      })
      const dayCounts = new Map<string, number>()
      const picked = pickTemplate(s, 0, dayCounts)!
      expect(picked.template_slug).not.toBe("cutout-spotlight")
      expect(picked.template_slug).not.toBe("cutout-spotlight-v2")
    })

    it("DAILY GUARANTEE 2026-05-26: fires for single-color product with back image (was unreachable before)", () => {
      // Real-world bug found 2026-05-26: 4/7 cutout-eligible slots in
      // tomorrow's plan, 0 cutouts picked. Root cause: the guarantee sat
      // AFTER the 1-color-front-back branch which returns early. Any single-
      // color product with a back image exited before reaching cutout.
      // Promotion of the guarantee + single-color constraint fixes this.
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "back", "cutout"])],
        variant_in_stock_count: 1,
      })
      const dayCounts = new Map<string, number>()
      const picked = pickTemplate(s, 0, dayCounts)!
      expect(picked.template_slug).toBe("cutout-spotlight")
      expect(picked.slot_inputs.product_cutout).toBe("https://r2/pink-cutout.png")
    })

    it("DAILY GUARANTEE 2026-05-26: wins over on-sale and new-arrival for single-color first eligible slot", () => {
      // The promotion intentionally hijacks on-sale / new-arrival when this
      // is the day's only cutout chance. Sales are still shown in *other*
      // slots; the policy is "≥1 cutout per day if a single-color eligible
      // product exists" not "no cutout if anything else is competing".
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "back", "cutout"])],
        variant_in_stock_count: 1,
        is_new_arrival: true,
        compare_at_price_mur: 9999,
        price_mur: 4999,
      })
      const dayCounts = new Map<string, number>()
      const picked = pickTemplate(s, 0, dayCounts)!
      expect(picked.template_slug).toBe("cutout-spotlight")
    })
  })

  describe("REGRESSION: 2-color template never picks the same front for both colors", () => {
    // Real-world bug (2026-05-21, IS1587 Pleated Sleeveless Jumpsuit):
    // The catalog uses shared image_urls across all variants — both red and
    // blue rows contain [red.jpg, red-b.jpg, blue.jpg, blue-b.jpg]. The picker
    // was returning the same red front for BOTH slot_inputs.front_a and
    // .front_b, so the rendered MP4 showed "2 colors available" with two
    // identical red images.
    it("front_b is a distinct URL from front_a when image lists are shared across variants", () => {
      const sharedFronts = [
        "https://r2/IS1587-red.jpg",
        "https://r2/IS1587-red-b.jpg",
        "https://r2/IS1587-blue.jpg",
        "https://r2/IS1587-blue-b.jpg",
      ]
      const s = snapshot({
        variants_in_stock: [
          { id: "red", sku: "IS1587-M-R", color: "Red", color_code: null, sizes: ["S", "M"], image_urls: sharedFronts },
          { id: "blue", sku: "IS1587-M-B", color: "Blue", color_code: null, sizes: ["M"], image_urls: sharedFronts },
        ],
        variant_in_stock_count: 2,
      })
      const picked = pickTemplate(s, 0)!
      expect(picked.template_slug).toMatch(/^product-2colors/)
      expect(picked.slot_inputs.front_a).not.toBe(picked.slot_inputs.front_b)
      // Specifically the picker should land on the red front first, blue second
      expect(picked.slot_inputs.front_a).toBe("https://r2/IS1587-red.jpg")
      expect(picked.slot_inputs.front_b).toBe("https://r2/IS1587-blue.jpg")
    })

    it("3-color template picks 3 distinct fronts when image lists are shared", () => {
      const sharedFronts = [
        "https://r2/IS9999-red.jpg",
        "https://r2/IS9999-red-b.jpg",
        "https://r2/IS9999-blue.jpg",
        "https://r2/IS9999-green.jpg",
      ]
      const s = snapshot({
        variants_in_stock: [
          { id: "red", sku: "IS9999-R", color: "Red", color_code: null, sizes: ["M"], image_urls: sharedFronts },
          { id: "blue", sku: "IS9999-B", color: "Blue", color_code: null, sizes: ["M"], image_urls: sharedFronts },
          { id: "green", sku: "IS9999-G", color: "Green", color_code: null, sizes: ["M"], image_urls: sharedFronts },
        ],
        variant_in_stock_count: 3,
      })
      const picked = pickTemplate(s, 0)!
      expect(picked.template_slug).toBe("product-3colors")
      const fronts = [picked.slot_inputs.front_a, picked.slot_inputs.front_b, picked.slot_inputs.front_c]
      expect(new Set(fronts).size).toBe(3) // all distinct
    })

    it("falls through to 1-color when 2 colors share an image list with only ONE distinct front", () => {
      // Only one front-classified image exists across the whole catalog. The
      // 2-color branch should fail (can't get distinct fronts) and fall down
      // to the 1-color rotation.
      const onlyOneFront = [
        "https://r2/IS0001-red.jpg",
        "https://r2/IS0001-red-b.jpg",
      ]
      const s = snapshot({
        variants_in_stock: [
          { id: "red", sku: "IS0001-R", color: "Red", color_code: null, sizes: ["M"], image_urls: onlyOneFront },
          { id: "blue", sku: "IS0001-B", color: "Blue", color_code: null, sizes: ["M"], image_urls: onlyOneFront },
        ],
        variant_in_stock_count: 2,
      })
      const picked = pickTemplate(s, 0)!
      expect(["product-1color", "product-1color-featured"]).toContain(picked.template_slug)
    })
  })

  describe("SKU is the parent product code (not the variant SKU)", () => {
    it("strips '-<size>-<color>' suffix so the story shows just the parent code", () => {
      const s = snapshot({
        variants_in_stock: [
          color("red", ["front", "back"], { sku: "IS2066-M-R" }),
        ],
        variant_in_stock_count: 1,
      })
      const picked = pickTemplate(s, 0)
      expect(picked!.text_overrides.sku).toBe("IS2066")
    })

    it("leaves a SKU with no hyphen unchanged (still capped at 10 chars)", () => {
      const s = snapshot({
        variants_in_stock: [color("red", ["front", "back"], { sku: "IS2066" })],
        variant_in_stock_count: 1,
      })
      const picked = pickTemplate(s, 0)
      expect(picked!.text_overrides.sku).toBe("IS2066")
    })

    it("caps non-conforming SKUs that have no hyphen at 10 chars (safety net)", () => {
      const s = snapshot({
        variants_in_stock: [
          color("red", ["front", "back"], { sku: "ABCDEFGHIJKLMNO" }),
        ],
        variant_in_stock_count: 1,
      })
      const picked = pickTemplate(s, 0)
      expect(picked!.text_overrides.sku).toBe("ABCDEFGHIJ")
    })
  })

  describe("per-day template cap (MAX_TEMPLATE_PER_DAY = 2)", () => {
    function oneColorWithBack(): ProductSnapshot {
      return snapshot({
        variants_in_stock: [color("red", ["front", "back"])],
        variant_in_stock_count: 1,
      })
    }

    it("first 15 single-color-with-back picks round-robin the 1-color pool (each once before any repeat)", () => {
      // 2026-05-25: pool grew from 3 to 15 templates (3 layouts × 4 palettes
      // + originals). True least-used round-robin produces each slug exactly
      // once across 15 slots; only on slot 16 does the first slug repeat.
      const s = oneColorWithBack()
      const counts = new Map<string, number>()
      const picks: string[] = []
      for (let i = 0; i < 15; i++) {
        const p = pickTemplate(s, i, counts)!
        picks.push(p.template_slug)
        counts.set(p.template_slug, (counts.get(p.template_slug) ?? 0) + 1)
      }
      // Every slug should appear exactly once — leastUsed prefers count=0
      // candidates, and ties resolve by pool order.
      const unique = new Set(picks)
      expect(unique.size).toBe(15)
      expect(picks[0]).toBe("product-1color")
      // Slot 16: the head of the pool comes around for its second hit.
      const p16 = pickTemplate(s, 15, counts)!
      expect(p16.template_slug).toBe("product-1color")
    })

    it("16th single-color-with-back falls through to the single-image rotation when all 1-color templates are capped", () => {
      // 2026-05-25: was 7th with a 3-template pool. With 15 templates, all
      // need to be at MAX_TEMPLATE_PER_DAY=2 before the fallthrough fires.
      const s = oneColorWithBack()
      const counts = new Map<string, number>([
        ["product-1color", 2],
        ["product-1color-blush", 2],
        ["product-1color-cream", 2],
        ["product-1color-sage", 2],
        ["product-1color-coral", 2],
        ["product-1color-featured", 2],
        ["product-1color-featured-blush", 2],
        ["product-1color-featured-cream", 2],
        ["product-1color-featured-sage", 2],
        ["product-1color-featured-coral", 2],
        ["new-drop-arch", 2],
        ["new-drop-arch-blush", 2],
        ["new-drop-arch-cream", 2],
        ["new-drop-arch-sage", 2],
        ["new-drop-arch-coral", 2],
      ])
      const p = pickTemplate(s, 30, counts)!
      expect([
        "in-stock-hero",
        "in-stock-hero-blush",
        "lifestyle-overlay",
        "in-stock-hero-cream",
        "just-arrived-editorial",
      ]).toContain(p.template_slug)
    })

    it("no template is picked more than twice across an 8-slot day", () => {
      const s = oneColorWithBack()
      const counts = new Map<string, number>()
      for (let i = 0; i < 8; i++) {
        const p = pickTemplate(s, i, counts)!
        counts.set(p.template_slug, (counts.get(p.template_slug) ?? 0) + 1)
      }
      for (const [slug, n] of counts) {
        expect({ slug, n }).toEqual({ slug, n: expect.any(Number) })
        expect(n).toBeLessThanOrEqual(2)
      }
    })

    it("on-sale is EXEMPT from the cap (sales always shown)", () => {
      const s = snapshot({
        price_mur: 990,
        compare_at_price_mur: 1490,
        variants_in_stock: [color("red", ["front", "back"])],
        variant_in_stock_count: 1,
      })
      const counts = new Map<string, number>([["on-sale", 5]])
      const p = pickTemplate(s, 0, counts)!
      expect(p.template_slug).toBe("on-sale")
    })

    it("3-color templates are EXEMPT from the cap (always shows a 3-color template)", () => {
      // 2026-05-21: THREE_COLOR_ROTATION now has two entries (product-3colors,
      // color-mood-rail). Exemption applies to both — even when product-3colors
      // is over its cap, the picker should fall to color-mood-rail (also 3-color)
      // rather than drop to a single-image template, so the daily feed doesn't
      // misrepresent multi-color products.
      const s = snapshot({
        variants_in_stock: [
          color("red", ["front", "back"]),
          color("pink", ["front"]),
          color("blue", ["front"]),
        ],
        variant_in_stock_count: 3,
      })
      const counts = new Map<string, number>([["product-3colors", 5]])
      const p = pickTemplate(s, 0, counts)!
      // Picker should still land on a 3-color template — leastUsed picks
      // color-mood-rail here (0 picks vs 5).
      expect(["product-3colors", "color-mood-rail"]).toContain(p.template_slug)
    })

    it("both 3-color templates exempt — picks one even when BOTH are over the cap", () => {
      const s = snapshot({
        variants_in_stock: [
          color("red", ["front", "back"]),
          color("pink", ["front"]),
          color("blue", ["front"]),
        ],
        variant_in_stock_count: 3,
      })
      const counts = new Map<string, number>([
        ["product-3colors", 5],
        ["color-mood-rail", 5],
      ])
      const p = pickTemplate(s, 0, counts)!
      expect(["product-3colors", "color-mood-rail"]).toContain(p.template_slug)
    })

    it("all five product-2colors palette siblings must be capped before falling through to product-2colors-front", () => {
      // 2026-05-25: 2-color pool grew from 1 to 5 siblings. The
      // `TWO_COLOR_BACK_ROTATION.some(...)` guard means fall-through only
      // fires when EVERY sibling is at cap.
      const s = snapshot({
        variants_in_stock: [
          color("red", ["front", "back"]),
          color("pink", ["front"]),
        ],
        variant_in_stock_count: 2,
      })
      const counts = new Map<string, number>([
        ["product-2colors", 2],
        ["product-2colors-blush", 2],
        ["product-2colors-cream", 2],
        ["product-2colors-sage", 2],
        ["product-2colors-coral", 2],
      ])
      const p = pickTemplate(s, 0, counts)!
      expect(p.template_slug).toBe("product-2colors-front")
    })

    it("when no pickedSoFar is passed, picker behavior is unchanged (back-compat)", () => {
      const s = oneColorWithBack()
      const slugs = [0, 1, 2, 3].map((i) => pickTemplate(s, i)!.template_slug)
      // Without a count map, the picker stays deterministic by slotIndex
      // across the 15-template 1-color pool (added 2026-05-25). Slots 0..3
      // land on the first four entries of ONE_COLOR_FRONT_BACK_ROTATION.
      expect(slugs).toEqual([
        "product-1color",
        "product-1color-blush",
        "product-1color-cream",
        "product-1color-sage",
      ])
    })
  })

  describe("2026-05-21: new-drop-arch (1-color front+back)", () => {
    it("uses front + back slots from the lead color", () => {
      const s = snapshot({
        variants_in_stock: [
          color("pink", ["front", "back"], { sku: "IS2200-M-P" }),
        ],
        variant_in_stock_count: 1,
      })
      // Slot index 10 lands on new-drop-arch in the 15-template 1-color
      // rotation (5 product-1color + 5 product-1color-featured + 5 new-drop-arch).
      const picked = pickTemplate(s, 10)!
      expect(picked.template_slug).toBe("new-drop-arch")
      expect(picked.slot_inputs.front).toBe("https://r2/pink.jpg")
      expect(picked.slot_inputs.back).toBe("https://r2/pink-b.jpg")
      // Should NOT have product-3colors slots (regression check)
      expect(picked.slot_inputs.front_a).toBeUndefined()
      expect(picked.slot_inputs.back).toBeDefined()
    })

    it("populates headline (product name), price, size text overrides", () => {
      const s = snapshot({
        name: "Cowl Neck Satin Midi",
        variants_in_stock: [
          color("pink", ["front", "back"], { sku: "IS2200-M-P", sizes: ["S", "M", "L"] }),
        ],
        variant_in_stock_count: 1,
        price_mur: 1290,
      })
      const picked = pickTemplate(s, 10)!
      expect(picked.template_slug).toBe("new-drop-arch")
      expect(picked.text_overrides.headline).toBe("Cowl Neck Satin Midi")
      expect(picked.text_overrides.price).toBe("Rs.1290")
      expect(picked.text_overrides.size).toBe("Size: S · M · L")
      expect(picked.text_overrides.sku).toBe("IS2200")
    })

    it("truncates a long product name in the headline override", () => {
      const s = snapshot({
        name: "Long Spaghetti-Strap Ruched Cowl Neck Satin Midi Dress",
        variants_in_stock: [color("pink", ["front", "back"])],
        variant_in_stock_count: 1,
      })
      const picked = pickTemplate(s, 10)!
      expect(picked.template_slug).toBe("new-drop-arch")
      expect(picked.text_overrides.headline.length).toBeLessThanOrEqual(28)
      expect(picked.text_overrides.headline).toMatch(/…$/)
    })
  })

  describe("2026-05-21: just-arrived-editorial (single-image rotation)", () => {
    it("lands on just-arrived-editorial at slot index 4 in the rotation", () => {
      const s = snapshot({
        variants_in_stock: [color("pink", ["front"])],
        variant_in_stock_count: 1,
      })
      const picked = pickTemplate(s, 4)!
      expect(picked.template_slug).toBe("just-arrived-editorial")
      expect(picked.slot_inputs.hero).toBe("https://r2/pink.jpg")
    })

    it("populates product_name, price, size text overrides", () => {
      const s = snapshot({
        name: "Linen Wrap Mini",
        variants_in_stock: [
          color("pink", ["front"], { sku: "IS2300-M-P", sizes: ["S", "M"] }),
        ],
        variant_in_stock_count: 1,
        price_mur: 990,
      })
      const picked = pickTemplate(s, 4)!
      expect(picked.template_slug).toBe("just-arrived-editorial")
      expect(picked.text_overrides.product_name).toBe("Linen Wrap Mini")
      expect(picked.text_overrides.price).toBe("Rs.990")
      expect(picked.text_overrides.size).toBe("Size: S · M")
    })

    it("on-sale still wins over just-arrived-editorial", () => {
      const s = snapshot({
        price_mur: 990,
        compare_at_price_mur: 1490,
        variants_in_stock: [color("pink", ["front"])],
        variant_in_stock_count: 1,
      })
      expect(pickTemplate(s, 4)!.template_slug).toBe("on-sale")
    })

    it("new-arrival still wins over just-arrived-editorial for fresh products", () => {
      const s = snapshot({
        variants_in_stock: [color("pink", ["front"])],
        variant_in_stock_count: 1,
        is_new_arrival: true,
      })
      expect(pickTemplate(s, 4)!.template_slug).toBe("new-arrival")
    })
  })

  it("editorial-cover-hero is reachable and gets real overrides", () => {
    const s = snapshot({
      name: "Linen Wrap Dress",
      price_mur: 1290,
      variants_in_stock: [color("pink", ["front"], { sku: "IS2364-M-P", sizes: ["S", "M", "L"] })],
      variant_in_stock_count: 1,
    })
    const picked = new Map<string, number>([
      ["in-stock-hero", 2],
      ["in-stock-hero-blush", 2],
      ["lifestyle-overlay", 2],
      ["in-stock-hero-cream", 2],
      ["just-arrived-editorial", 2],
      ["split-thirds-editorial", 2],
      ["receipt-tag-1color", 2],
      ["framed-gallery-1color", 2],
    ])
    const result = pickTemplate(s, 0, picked)
    expect(result).not.toBeNull()
    expect(result!.template_slug).toBe("editorial-cover-hero")
    expect(result!.slot_inputs.hero).toBe("https://r2/pink.jpg")
    expect(result!.text_overrides.price).toBe("Rs.1290")
    expect(result!.text_overrides.sku).toBe("IS2364")
    expect(result!.text_overrides.size).toContain("L")
  })

  it("split-thirds-editorial gets headline=name + price + size", () => {
    const s = snapshot({
      name: "Ribbed Knit Top",
      price_mur: 850,
      variants_in_stock: [color("ecru", ["front"], { sku: "IS1900-M-E", sizes: ["S", "M"] })],
      variant_in_stock_count: 1,
    })
    const picked = new Map<string, number>([
      ["in-stock-hero", 2], ["in-stock-hero-blush", 2], ["lifestyle-overlay", 2],
      ["in-stock-hero-cream", 2], ["just-arrived-editorial", 2],
      ["editorial-cover-hero", 2], ["receipt-tag-1color", 2], ["framed-gallery-1color", 2],
    ])
    const result = pickTemplate(s, 0, picked)
    expect(result!.template_slug).toBe("split-thirds-editorial")
    expect(result!.text_overrides.headline).toBe("Ribbed Knit Top")
    expect(result!.text_overrides.price).toBe("Rs.850")
  })

  describe("2026-05-21: color-mood-rail (3-color, front-only)", () => {
    it("picks color-mood-rail when 3 colors exist but NO back shot anywhere", () => {
      // The pink/blue/white variants only have front shots — product-3colors
      // requires a back, so the picker must fall to color-mood-rail.
      const s = snapshot({
        variants_in_stock: [
          color("pink", ["front"]),
          color("blue", ["front"]),
          color("white", ["front"]),
        ],
        variant_in_stock_count: 3,
      })
      const picked = pickTemplate(s, 0)!
      expect(picked.template_slug).toBe("color-mood-rail")
      expect(picked.slot_inputs.hero).toBe("https://r2/pink.jpg")
      expect(picked.slot_inputs.color_a).toBe("https://r2/pink.jpg")
      expect(picked.slot_inputs.color_b).toBe("https://r2/blue.jpg")
      expect(picked.slot_inputs.color_c).toBe("https://r2/white.jpg")
    })

    it("populates color_a/b/c labels from variant color names", () => {
      const s = snapshot({
        name: "Wrap Sleeve Dress",
        variants_in_stock: [
          color("v1", ["front"], { color: "Cream" }),
          color("v2", ["front"], { color: "Sage" }),
          color("v3", ["front"], { color: "Black" }),
        ],
        variant_in_stock_count: 3,
      })
      const picked = pickTemplate(s, 0)!
      expect(picked.template_slug).toBe("color-mood-rail")
      expect(picked.text_overrides.color_a_label).toBe("Cream")
      expect(picked.text_overrides.color_b_label).toBe("Sage")
      expect(picked.text_overrides.color_c_label).toBe("Black")
      expect(picked.text_overrides.product_name).toBe("Wrap Sleeve Dress")
    })

    it("rotates with product-3colors when a back is available (slot 0 → product-3colors, slot 1 → color-mood-rail)", () => {
      const s = snapshot({
        variants_in_stock: [
          color("pink", ["front", "back"]),
          color("blue", ["front"]),
          color("white", ["front"]),
        ],
        variant_in_stock_count: 3,
      })
      expect(pickTemplate(s, 0)!.template_slug).toBe("product-3colors")
      expect(pickTemplate(s, 1)!.template_slug).toBe("color-mood-rail")
      expect(pickTemplate(s, 2)!.template_slug).toBe("product-3colors")
      expect(pickTemplate(s, 3)!.template_slug).toBe("color-mood-rail")
    })

    it("on-sale still wins over color-mood-rail (sale signal is stronger than multi-color layout)", () => {
      const s = snapshot({
        price_mur: 990,
        compare_at_price_mur: 1490,
        variants_in_stock: [
          color("pink", ["front"]),
          color("blue", ["front"]),
          color("white", ["front"]),
        ],
        variant_in_stock_count: 3,
      })
      expect(pickTemplate(s, 0)!.template_slug).toBe("on-sale")
    })

    it("REGRESSION: color-mood-rail never receives a back slot in slot_inputs", () => {
      // The color-mood-rail template HTML doesn't have a `data-hf-image="back"`
      // attribute — feeding it a back would be a silent miss.
      const s = snapshot({
        variants_in_stock: [
          color("pink", ["front", "back"]),
          color("blue", ["front"]),
          color("white", ["front"]),
        ],
        variant_in_stock_count: 3,
      })
      // slot 1 lands on color-mood-rail per the rotation
      const picked = pickTemplate(s, 1)!
      expect(picked.template_slug).toBe("color-mood-rail")
      expect(picked.slot_inputs.back).toBeUndefined()
    })

    it("least-used rotation balances product-3colors vs color-mood-rail when a count map is passed", () => {
      const s = snapshot({
        variants_in_stock: [
          color("pink", ["front", "back"]),
          color("blue", ["front"]),
          color("white", ["front"]),
        ],
        variant_in_stock_count: 3,
      })
      const counts = new Map<string, number>([["product-3colors", 3]])
      // color-mood-rail has 0 picks vs product-3colors's 3 → least-used picks color-mood-rail
      const p = pickTemplate(s, 0, counts)!
      expect(p.template_slug).toBe("color-mood-rail")
    })
  })

  describe("2026-05-25: palette siblings (blush / cream / sage / coral)", () => {
    it("1-color rotation includes all 15 layout × palette siblings", () => {
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "back"])],
        variant_in_stock_count: 1,
      })
      const slugs = Array.from({ length: 15 }, (_, i) =>
        pickTemplate(s, i)!.template_slug,
      )
      const expectedSiblings = [
        "product-1color-blush",
        "product-1color-cream",
        "product-1color-sage",
        "product-1color-coral",
        "product-1color-featured-blush",
        "product-1color-featured-cream",
        "product-1color-featured-sage",
        "product-1color-featured-coral",
        "new-drop-arch-blush",
        "new-drop-arch-cream",
        "new-drop-arch-sage",
        "new-drop-arch-coral",
      ]
      for (const sibling of expectedSiblings) {
        expect(slugs).toContain(sibling)
      }
    })

    it("2-color back rotation hands out all 5 palette siblings across 5 slots when a count map is passed", () => {
      const s = snapshot({
        variants_in_stock: [
          color("red", ["front", "back"]),
          color("pink", ["front"]),
        ],
        variant_in_stock_count: 2,
      })
      const counts = new Map<string, number>()
      const picks: string[] = []
      for (let i = 0; i < 5; i++) {
        const p = pickTemplate(s, i, counts)!
        picks.push(p.template_slug)
        counts.set(p.template_slug, (counts.get(p.template_slug) ?? 0) + 1)
      }
      // Each of the 5 siblings should appear exactly once.
      expect(new Set(picks).size).toBe(5)
      expect(picks).toContain("product-2colors")
      expect(picks).toContain("product-2colors-blush")
      expect(picks).toContain("product-2colors-cream")
      expect(picks).toContain("product-2colors-sage")
      expect(picks).toContain("product-2colors-coral")
    })

    it("palette siblings preserve the slot contract — front_a / front_b / back routed correctly", () => {
      // Regression guard: variant templates copy the base index.html, so the
      // picker must pass the same slot_inputs regardless of which palette
      // sibling is chosen.
      const s = snapshot({
        variants_in_stock: [
          color("red", ["front", "back"]),
          color("pink", ["front"]),
        ],
        variant_in_stock_count: 2,
      })
      const counts = new Map<string, number>([["product-2colors", 2]])
      const p = pickTemplate(s, 0, counts)!
      expect(p.template_slug).not.toBe("product-2colors") // pushed by count
      expect(p.slot_inputs.front_a).toBeDefined()
      expect(p.slot_inputs.front_b).toBeDefined()
      expect(p.slot_inputs.back).toBeDefined()
    })

    it("1-color palette siblings reuse the front/back slot contract", () => {
      const s = snapshot({
        variants_in_stock: [color("pink", ["front", "back"])],
        variant_in_stock_count: 1,
      })
      // Slot index 1 is product-1color-blush in the new rotation.
      const p = pickTemplate(s, 1)!
      expect(p.template_slug).toBe("product-1color-blush")
      expect(p.slot_inputs.front).toBe("https://r2/pink.jpg")
      expect(p.slot_inputs.back).toBe("https://r2/pink-b.jpg")
    })
  })

  describe("2026-05-26: palette variants populate text_overrides (regression for Rs.0 / IS0000 bug)", () => {
    // Bug shipped on 2026-05-26: the rendered MP4 for product-1color-blush
    // showed "Rs.0" and "IS0000" — the template's default placeholder values
    // — because buildTextOverrides only had a case arm for the base slug
    // (product-1color), not for the palette siblings. They fell through to
    // the default branch which returned {} → template rendered with defaults.
    // These regressions assert every palette sibling gets the same overrides
    // its base does.

    const ONE_COLOR_PALETTE_SLUGS = [
      "product-1color-blush",
      "product-1color-cream",
      "product-1color-sage",
      "product-1color-coral",
      "product-1color-featured-blush",
      "product-1color-featured-cream",
      "product-1color-featured-sage",
      "product-1color-featured-coral",
    ] as const

    const NEW_DROP_ARCH_PALETTE_SLUGS = [
      "new-drop-arch-blush",
      "new-drop-arch-cream",
      "new-drop-arch-sage",
      "new-drop-arch-coral",
    ] as const

    const TWO_COLORS_PALETTE_SLUGS = [
      "product-2colors-blush",
      "product-2colors-cream",
      "product-2colors-sage",
      "product-2colors-coral",
    ] as const

    // Walk the deterministic (no-count-map) rotation and find the first slot
    // index where the picker lands on the requested slug. Returns null if
    // the slug never appears in 60 slots — useful for skipping cases where
    // rotation order doesn't reach a palette in the test snapshot.
    function findSlotIndexFor(s: ProductSnapshot, slug: string): number | null {
      for (let i = 0; i < 60; i++) {
        const p = pickTemplate(s, i)
        if (p?.template_slug === slug) return i
      }
      return null
    }

    it.each(ONE_COLOR_PALETTE_SLUGS)(
      "%s populates price + size + sku (not template defaults)",
      (slug) => {
        const s = snapshot({
          name: "Satin Dress",
          price_mur: 1290,
          variants_in_stock: [color("pink", ["front", "back"], { sku: "IS2161-M-PINK" })],
          variant_in_stock_count: 1,
        })
        const idx = findSlotIndexFor(s, slug)
        expect(idx).not.toBeNull()
        // No count map = deterministic slot-index rotation. The slug at idx
        // by deterministic rotation is what findSlotIndexFor returned.
        const p = pickTemplate(s, idx!)!
        expect(p.template_slug).toBe(slug)
        expect(p.text_overrides.price).toBe("Rs.1290")
        expect(p.text_overrides.size).toBe("Size: S · M")
        expect(p.text_overrides.sku).toBe("IS2161")
      },
    )

    it.each(NEW_DROP_ARCH_PALETTE_SLUGS)(
      "%s populates price + size + headline + sku",
      (slug) => {
        const s = snapshot({
          name: "Satin Maxi Dress",
          price_mur: 1290,
          variants_in_stock: [color("pink", ["front", "back"], { sku: "IS2008-M-PINK" })],
          variant_in_stock_count: 1,
        })
        const idx = findSlotIndexFor(s, slug)
        expect(idx).not.toBeNull()
        const p = pickTemplate(s, idx!)!
        expect(p.template_slug).toBe(slug)
        expect(p.text_overrides.price).toBe("Rs.1290")
        expect(p.text_overrides.size).toBe("Size: S · M")
        expect(p.text_overrides.headline).toBe("Satin Maxi Dress")
        expect(p.text_overrides.sku).toBe("IS2008")
      },
    )

    it.each(TWO_COLORS_PALETTE_SLUGS)(
      "%s populates price + size_a + size_b + sku",
      (slug) => {
        const s = snapshot({
          name: "Two Color Dress",
          price_mur: 1290,
          variants_in_stock: [
            color("red", ["front", "back"], { sku: "IS2058-M-RED", sizes: ["S", "M"] }),
            color("blue", ["front", "back"], { sku: "IS2058-M-BLUE", sizes: ["M", "L"] }),
          ],
          variant_in_stock_count: 2,
        })
        const idx = findSlotIndexFor(s, slug)
        expect(idx).not.toBeNull()
        const p = pickTemplate(s, idx!)!
        expect(p.template_slug).toBe(slug)
        expect(p.text_overrides.price).toBe("Rs.1290")
        expect(p.text_overrides.size_a).toBe("S · M")
        expect(p.text_overrides.size_b).toBe("M · L")
        expect(p.text_overrides.sku).toBe("IS2058")
      },
    )

  })
})
