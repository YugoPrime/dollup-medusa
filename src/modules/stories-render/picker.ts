import type { ProductSnapshot, SnapshotVariant } from "../stories/snapshot"

export type PickedRender = {
  template_slug: string
  slot_inputs: Record<string, string>
  text_overrides: Record<string, string>
}

// new-arrival is intentionally NOT in the rotation pool — it should only fire
// when the product is actually new (snapshot.is_new_arrival=true). Including
// it here would put "NEW ARRIVAL" stamps on old products.
const SINGLE_IMAGE_ROTATION = ["in-stock-hero", "lifestyle-overlay"] as const

function priceLabel(amount: number): string {
  return `Rs.${amount}`
}

function firstSku(snapshot: ProductSnapshot): string | null {
  const sku = snapshot.variants_in_stock[0]?.sku
  return sku ? sku.slice(0, 10) : null
}

function collectSizes(snapshot: ProductSnapshot, maxChars: number): string {
  const seen = new Set<string>()
  for (const v of snapshot.variants_in_stock) for (const s of v.sizes) seen.add(s)
  if (seen.size === 0) return "Size: S, M, L".slice(0, maxChars)
  const label = `Size: ${Array.from(seen).join(", ")}`
  return label.length <= maxChars ? label : label.slice(0, maxChars - 1) + "…"
}

function pickFront(variant: SnapshotVariant | undefined): string | null {
  return variant?.image_urls[0] ?? null
}

function pickBackFromAnyOther(
  colors: SnapshotVariant[],
  exceptIndex: number,
): string | null {
  for (let i = 0; i < colors.length; i++) {
    if (i === exceptIndex) continue
    const back = colors[i].image_urls[1] ?? colors[i].image_urls[0]
    if (back) return back
  }
  return null
}

function buildTextOverrides(
  slug: string,
  snapshot: ProductSnapshot,
): Record<string, string> {
  const price = priceLabel(snapshot.price_mur)
  const sku = firstSku(snapshot)
  const out: Record<string, string> = {}

  switch (slug) {
    case "on-sale": {
      out.old_price = priceLabel(snapshot.compare_at_price_mur ?? snapshot.price_mur)
      out.new_price = price
      out.size = collectSizes(snapshot, 28)
      if (sku) out.sku = sku
      return out
    }
    case "in-stock-hero": {
      out.price = price
      out.size = collectSizes(snapshot, 28)
      if (sku) out.sku = sku
      return out
    }
    case "lifestyle-overlay": {
      out.price = price
      out.size = collectSizes(snapshot, 24)
      if (sku) out.sku = sku
      return out
    }
    case "new-arrival":
    case "product-1color":
    case "product-2colors":
    case "product-3colors":
    case "many-photos": {
      out.price = price
      if (sku) out.sku = sku
      return out
    }
    default:
      return out
  }
}

/**
 * Pure function. Given a slot's product snapshot + its slot index in the day,
 * picks the best template and computes the slot_inputs + text_overrides needed
 * to render it.
 *
 * Decision order:
 *   1. compare_at_price set + above current price → "on-sale"
 *   2. multi-image cascade by color count: 3+ colors → product-3colors,
 *      2 colors → product-2colors, 1 color with ≥ 2 photos → product-1color
 *   3. otherwise rotate single-image pool [in-stock-hero, new-arrival,
 *      lifestyle-overlay] by slotIndex so the daily feed has variety
 *
 * Templates intentionally not auto-picked in v1 (they need inputs the snapshot
 * alone can't satisfy): how-to-order (no product), customer-review (quote +
 * reviewer name), cutout-spotlight (transparent-bg PNG), many-photos (needs
 * 8 distinct photos which boutique product shoots rarely have).
 *
 * Returns null when the snapshot has no in-stock variant with at least one
 * image — caller should leave the slot un-rendered rather than fail.
 */
export function pickTemplate(
  snapshot: ProductSnapshot | null,
  slotIndex: number,
): PickedRender | null {
  if (!snapshot) return null
  const colors = snapshot.variants_in_stock
  if (colors.length === 0) return null
  const allImages = colors.flatMap((c) => c.image_urls)
  if (allImages.length === 0) return null

  if (
    snapshot.compare_at_price_mur != null &&
    snapshot.compare_at_price_mur > snapshot.price_mur
  ) {
    const hero = pickFront(colors[0])
    if (hero) {
      return {
        template_slug: "on-sale",
        slot_inputs: { hero },
        text_overrides: buildTextOverrides("on-sale", snapshot),
      }
    }
  }

  if (colors.length >= 3) {
    const a = pickFront(colors[0])
    const b = pickFront(colors[1])
    const c = pickFront(colors[2])
    const back =
      colors[0].image_urls[1] ?? pickBackFromAnyOther(colors, 0) ?? a
    if (a && b && c && back) {
      return {
        template_slug: "product-3colors",
        slot_inputs: { front_a: a, front_b: b, front_c: c, back },
        text_overrides: buildTextOverrides("product-3colors", snapshot),
      }
    }
  }

  if (colors.length >= 2) {
    const a = pickFront(colors[0])
    const b = pickFront(colors[1])
    const back =
      colors[0].image_urls[1] ?? pickBackFromAnyOther(colors, 0) ?? a
    if (a && b && back) {
      return {
        template_slug: "product-2colors",
        slot_inputs: { front_a: a, front_b: b, back },
        text_overrides: buildTextOverrides("product-2colors", snapshot),
      }
    }
  }

  if (colors[0].image_urls.length >= 2) {
    return {
      template_slug: "product-1color",
      slot_inputs: {
        front: colors[0].image_urls[0],
        back: colors[0].image_urls[1],
      },
      text_overrides: buildTextOverrides("product-1color", snapshot),
    }
  }

  // Single photo, single color: prefer new-arrival when it actually IS new,
  // else fall back to the rotation pool for variety.
  if (snapshot.is_new_arrival) {
    return {
      template_slug: "new-arrival",
      slot_inputs: { hero: colors[0].image_urls[0] },
      text_overrides: buildTextOverrides("new-arrival", snapshot),
    }
  }

  const slug = SINGLE_IMAGE_ROTATION[slotIndex % SINGLE_IMAGE_ROTATION.length]
  const hero = colors[0].image_urls[0]
  const slotInputs: Record<string, string> =
    slug === "lifestyle-overlay" ? { lifestyle: hero } : { hero }
  return {
    template_slug: slug,
    slot_inputs: slotInputs,
    text_overrides: buildTextOverrides(slug, snapshot),
  }
}
