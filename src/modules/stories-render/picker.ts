import { classifyImageKind } from "../stories/image-kind"
import type { ProductSnapshot, SnapshotVariant } from "../stories/snapshot"

export type PickedRender = {
  template_slug: string
  slot_inputs: Record<string, string>
  text_overrides: Record<string, string>
}

// new-arrival is intentionally NOT in the rotation pool — it should only fire
// when the product is actually new (snapshot.is_new_arrival=true). Including
// it here would put "NEW ARRIVAL" stamps on old products.
//
// in-stock-hero-blush + -cream are visual variants of in-stock-hero with
// different background palettes (blush gradient, cream + gold). They share
// the same slot/text contract; rotation gives the daily feed visual variety.
const SINGLE_IMAGE_ROTATION = [
  "in-stock-hero",
  "in-stock-hero-blush",
  "lifestyle-overlay",
  "in-stock-hero-cream",
] as const

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

/**
 * Returns the clean catalog "front" shot for the variant.
 * Order of preference:
 *   1. first image classified as "front"
 *   2. if image[0] is "other" (unrecognized suffix), use it — by Medusa
 *      convention image #1 is the catalog thumbnail, almost always a front
 *      shot uploaded without the canonical suffix
 *   3. null — real/detail/size_chart shots are explicitly NEVER used as front
 */
function pickFront(variant: SnapshotVariant | undefined): string | null {
  if (!variant || variant.image_urls.length === 0) return null
  for (const url of variant.image_urls) {
    if (classifyImageKind(url) === "front") return url
  }
  // Defensive fallback: Medusa thumbnail is usually image[0]. If it doesn't
  // match our convention but isn't a known role suffix, take it as the front.
  if (classifyImageKind(variant.image_urls[0]) === "other") {
    return variant.image_urls[0]
  }
  return null
}

/**
 * Returns the clean "-b" back shot for the variant, or null. NEVER returns a
 * real/detail/size_chart/other shot — that was the original bug.
 */
function pickBack(variant: SnapshotVariant | undefined): string | null {
  if (!variant) return null
  for (const url of variant.image_urls) {
    if (classifyImageKind(url) === "back") return url
  }
  return null
}

/**
 * Looks for a clean back shot across all other colors, used as a fallback when
 * the lead color has no back of its own.
 */
function pickBackFromAnyOther(
  colors: SnapshotVariant[],
  exceptIndex: number,
): string | null {
  for (let i = 0; i < colors.length; i++) {
    if (i === exceptIndex) continue
    const back = pickBack(colors[i])
    if (back) return back
  }
  return null
}

/**
 * Returns the first transparent-bg cutout PNG found across any color, or null.
 * Cutouts are uploaded out-of-band (rembg pipeline) and signal that the
 * product is eligible for the editorial cutout-spotlight template.
 */
function pickCutout(colors: SnapshotVariant[]): string | null {
  for (const c of colors) {
    for (const url of c.image_urls) {
      if (classifyImageKind(url) === "cutout") return url
    }
  }
  return null
}

/**
 * True when any variant has a "-r" real / on-model shot. cutout-spotlight is
 * intentionally suppressed when a real shot exists — lifestyle-overlay gives
 * a stronger story for products with real photography. Cutout is the fallback
 * for studio-only products.
 */
function hasRealShot(colors: SnapshotVariant[]): boolean {
  for (const c of colors) {
    for (const url of c.image_urls) {
      if (classifyImageKind(url) === "real") return true
    }
  }
  return false
}

/**
 * Returns the best image to plug into the lifestyle-overlay template. This is
 * the ONE template that's allowed to feature a real / on-model shot — that's
 * its whole purpose. Preference order:
 *   1. first "-r" real shot (across all colors)
 *   2. first "other" shot (off-convention upload that's probably a lifestyle)
 *   3. front fallback so the lifestyle slot still fires when no real exists
 */
function pickLifestyle(colors: SnapshotVariant[]): string | null {
  for (const c of colors) {
    for (const url of c.image_urls) {
      if (classifyImageKind(url) === "real") return url
    }
  }
  for (const c of colors) {
    for (const url of c.image_urls) {
      if (classifyImageKind(url) === "other") return url
    }
  }
  return pickFront(colors[0])
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
    case "in-stock-hero":
    case "in-stock-hero-blush":
    case "in-stock-hero-cream": {
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
    case "cutout-spotlight": {
      out.price = price
      out.size = collectSizes(snapshot, 28)
      if (sku) out.sku = sku
      return out
    }
    case "new-arrival":
    case "product-1color":
    case "product-2colors":
    case "product-2colors-front":
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
 * Image-role rules (critical — see image-kind.ts):
 *   - Product templates (on-sale, product-Ncolors, new-arrival, in-stock-hero)
 *     accept ONLY "front" / "back" shots in their slots. Real / detail /
 *     size-chart shots are never plugged in.
 *   - lifestyle-overlay is the only template that consumes a real shot.
 *
 * Decision order:
 *   1. compare_at_price set + above current price → "on-sale"
 *   2. multi-image cascade by color count: 3+ colors with backs available →
 *      product-3colors, 2 colors → product-2colors, 1 color with front + back
 *      → product-1color
 *   3. otherwise rotate the single-image pool [in-stock-hero, lifestyle-overlay]
 *      by slotIndex so the daily feed has variety
 *
 * Returns null when there's no usable front image — e.g. variants only have
 * real/detail/size_chart shots. Callers (batch render) skip the slot in that
 * case rather than push an off-template story.
 */
export function pickTemplate(
  snapshot: ProductSnapshot | null,
  slotIndex: number,
): PickedRender | null {
  if (!snapshot) return null
  const colors = snapshot.variants_in_stock
  if (colors.length === 0) return null

  // Gate everything on having at least one usable front-class image.
  // pickFront enforces "no real/detail/size_chart used as front" — if it
  // returns null we have nothing to put on a stock-style story.
  const leadFront = pickFront(colors[0])
  if (!leadFront) return null

  if (
    snapshot.compare_at_price_mur != null &&
    snapshot.compare_at_price_mur > snapshot.price_mur
  ) {
    return {
      template_slug: "on-sale",
      slot_inputs: { hero: leadFront },
      text_overrides: buildTextOverrides("on-sale", snapshot),
    }
  }

  if (colors.length >= 3) {
    const a = leadFront
    const b = pickFront(colors[1])
    const c = pickFront(colors[2])
    const back = pickBack(colors[0]) ?? pickBackFromAnyOther(colors, 0)
    if (a && b && c && back) {
      return {
        template_slug: "product-3colors",
        slot_inputs: { front_a: a, front_b: b, front_c: c, back },
        text_overrides: buildTextOverrides("product-3colors", snapshot),
      }
    }
  }

  if (colors.length >= 2) {
    const a = leadFront
    const b = pickFront(colors[1])
    const back = pickBack(colors[0]) ?? pickBackFromAnyOther(colors, 0)
    if (a && b && back) {
      return {
        template_slug: "product-2colors",
        slot_inputs: { front_a: a, front_b: b, back },
        text_overrides: buildTextOverrides("product-2colors", snapshot),
      }
    }
    // 2 fronts with no back available anywhere → fall back to the
    // front-only 2-color template instead of the single-image rotation.
    // Beats showing just one color when the catalog has two.
    if (a && b) {
      return {
        template_slug: "product-2colors-front",
        slot_inputs: { front_a: a, front_b: b },
        text_overrides: buildTextOverrides("product-2colors-front", snapshot),
      }
    }
  }

  const leadBack = pickBack(colors[0])
  if (leadBack) {
    return {
      template_slug: "product-1color",
      slot_inputs: { front: leadFront, back: leadBack },
      text_overrides: buildTextOverrides("product-1color", snapshot),
    }
  }

  // Single photo, single color: prefer new-arrival when it actually IS new,
  // else fall back to the rotation pool for variety.
  if (snapshot.is_new_arrival) {
    return {
      template_slug: "new-arrival",
      slot_inputs: { hero: leadFront },
      text_overrides: buildTextOverrides("new-arrival", snapshot),
    }
  }

  // cutout-spotlight is the fallback for products with NO real / lifestyle
  // background shot. When a "-r" image exists, lifestyle-overlay's stronger
  // story wins (see SINGLE_IMAGE_ROTATION). Cutout PNG is still gated —
  // without one, no spotlight even when the product is studio-only.
  const cutoutUrl = pickCutout(colors)
  if (cutoutUrl && !hasRealShot(colors)) {
    return {
      template_slug: "cutout-spotlight",
      slot_inputs: { product_cutout: cutoutUrl },
      text_overrides: buildTextOverrides("cutout-spotlight", snapshot),
    }
  }

  const slug = SINGLE_IMAGE_ROTATION[slotIndex % SINGLE_IMAGE_ROTATION.length]
  if (slug === "lifestyle-overlay") {
    const lifestyle = pickLifestyle(colors) ?? leadFront
    return {
      template_slug: slug,
      slot_inputs: { lifestyle },
      text_overrides: buildTextOverrides(slug, snapshot),
    }
  }
  return {
    template_slug: slug,
    slot_inputs: { hero: leadFront },
    text_overrides: buildTextOverrides(slug, snapshot),
  }
}
