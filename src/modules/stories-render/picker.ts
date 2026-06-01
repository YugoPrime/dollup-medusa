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
//
// just-arrived-editorial (2026-05-21) is an editorial cutout-hero treatment
// with a beige + leaf-accent palette. It uses the `hero` slot like in-stock-*
// so it slots in cleanly. Different visual language (serif word-reveal headline,
// Shop the look CTA) — gives the daily feed a fifth distinct look.
const SINGLE_IMAGE_ROTATION = [
  "in-stock-hero",
  "in-stock-hero-blush",
  "lifestyle-overlay",
  "in-stock-hero-cream",
  "just-arrived-editorial",
  "editorial-cover-hero",
  "split-thirds-editorial",
  "receipt-tag-1color",
  "framed-gallery-1color",
] as const

// 1-color, front + back available: rotate between three layouts × four
// palettes each, plus the original three (which use the canonical palette of
// their family). All share the same slot contract { front, back }; the picker
// swaps purely by least-used / slotIndex for variety.
//
// 2026-05-25: blush / cream / sage / coral palette siblings added for each of
// product-1color, product-1color-featured, new-drop-arch. Same DOM, same
// text contract; only the canvas + panel CSS differ.
const ONE_COLOR_FRONT_BACK_ROTATION = [
  "product-1color",
  "product-1color-blush",
  "product-1color-cream",
  "product-1color-sage",
  "product-1color-coral",
  "product-1color-featured",
  "product-1color-featured-blush",
  "product-1color-featured-cream",
  "product-1color-featured-sage",
  "product-1color-featured-coral",
  "new-drop-arch",
  "new-drop-arch-blush",
  "new-drop-arch-cream",
  "new-drop-arch-sage",
  "new-drop-arch-coral",
  // 2026-05-30: three front+back templates added to the rotation. They require
  // a real "-b" back shot like every other slug here, so they are HARD-GATED:
  // the 1-color-front-back branch only runs when pickBack returns a back. A
  // front-only product never reaches this rotation, so these three are
  // inherently unreachable without a back shot — the branch IS the gate.
  "cardflip-front-back",
  "lookbook-spread-back",
  "filmstrip-multiframe",
] as const

// 2-color templates with a back image. Was a single template
// (product-1color … sorry, product-2colors) until 2026-05-25 — palette
// siblings added so consecutive 2-color products in the feed read distinct.
// Same slot contract { front_a, front_b, back } across all five.
const TWO_COLOR_BACK_ROTATION = [
  "product-2colors",
  "product-2colors-blush",
  "product-2colors-cream",
  "product-2colors-sage",
  "product-2colors-coral",
] as const

// 2-color, FRONT-ONLY (no usable back). Was a single hardcoded
// product-2colors-front return; 2026-05-30 made a 3-way rotation so
// consecutive 2-color-no-back products read distinct. Same { front_a,
// front_b } slot contract across all entries. (diagonal-2color-wipe was
// removed 2026-05-31 — off-brand.)
const TWO_COLOR_FRONT_ROTATION = [
  "product-2colors-front",
  "swipe-through-2color",
] as const

// 3+ colors. product-3colors needs a clean back; color-mood-rail (added
// 2026-05-21) is the side-rail layout that shows 3 color thumbs WITHOUT
// needing a back shot. Picker uses color-mood-rail as a fallback when no back
// is available, and rotates between the two when a back exists so the daily
// feed isn't always the 2×2 flip.
const THREE_COLOR_ROTATION = [
  "product-3colors",
  "color-mood-rail",
] as const

/**
 * Hard daily cap per template — no more than this many slots in a single day
 * can use the same template. Prevents the feed feeling repetitive when many
 * products share the same shape (e.g. 5 single-color products would all have
 * been product-1color without this cap).
 *
 * Sale + new-arrival + product-3colors are exempt because they're tied to
 * product facts (compare_at_price, is_new_arrival, has-3-colors) — capping
 * them would mean misrepresenting the product, not just losing variety.
 */
const MAX_TEMPLATE_PER_DAY = 2

function countOf(picked: Map<string, number> | undefined, slug: string): number {
  return picked?.get(slug) ?? 0
}

function isSaturated(picked: Map<string, number> | undefined, slug: string): boolean {
  return countOf(picked, slug) >= MAX_TEMPLATE_PER_DAY
}

/**
 * Returns the slug in `candidates` with the lowest current daily count. Ties
 * are broken by list order (earlier candidate wins). True round-robin: with
 * two equally-empty candidates [A, B], picks land [A, B, A, B] rather than
 * [A, A, B, B] — better visual rhythm in the daily feed. Guarantees a non-null
 * pick as long as `candidates` is non-empty.
 */
function leastUsed(
  candidates: readonly string[],
  picked: Map<string, number> | undefined,
): string {
  let best = candidates[0]
  let bestCount = countOf(picked, best)
  for (let i = 1; i < candidates.length; i++) {
    const n = countOf(picked, candidates[i])
    if (n < bestCount) {
      best = candidates[i]
      bestCount = n
    }
  }
  return best
}

function priceLabel(amount: number): string {
  return `Rs.${amount}`
}

/**
 * Returns the PARENT product code only (e.g. "IS2066"), not the full variant
 * SKU ("IS2066-M-R"). The boutique's SKU convention is `<parent>-<size>-<color>`
 * separated by hyphens, so the parent is everything before the first `-`.
 * Slicing to 10 chars is kept as a safety net for any non-conforming SKU.
 */
function firstSku(snapshot: ProductSnapshot): string | null {
  const sku = snapshot.variants_in_stock[0]?.sku
  if (!sku) return null
  const parent = sku.split("-")[0] ?? sku
  return parent.slice(0, 10)
}

function collectSizes(snapshot: ProductSnapshot, maxChars: number): string {
  const seen = new Set<string>()
  for (const v of snapshot.variants_in_stock) for (const s of v.sizes) seen.add(s)
  if (seen.size === 0) return "One size"
  if (seen.size === 1) {
    const only = Array.from(seen)[0]
    // Single-size products that are explicitly "One size" / "OS" / "Free size"
    // shouldn't display "Size: One size" — normalize to a clean label.
    if (/^(one ?size|os|free ?size|f)$/i.test(only)) return "One size"
    const single = `Size: ${only}`
    return single.length <= maxChars ? single : single.slice(0, maxChars - 1) + "…"
  }
  const label = `Size: ${Array.from(seen).join(" · ")}`
  return label.length <= maxChars ? label : label.slice(0, maxChars - 1) + "…"
}

/**
 * Per-color size label for a single variant. Returned WITHOUT a "Size:" prefix
 * so the per-card pills stay compact ("S · M · L"). Single-size variants show
 * just the size ("M"); zero-size variants get "One size" so the rule "always
 * show size when product has sizes" still surfaces something readable.
 */
function sizesForVariant(variant: SnapshotVariant | undefined, maxChars: number): string {
  if (!variant) return ""
  const sizes = variant.sizes
  if (sizes.length === 0) return "One size"
  if (sizes.length === 1) {
    const only = sizes[0]
    if (/^(one ?size|os|free ?size|f)$/i.test(only)) return "One size"
    return only.length <= maxChars ? only : only.slice(0, maxChars - 1) + "…"
  }
  const label = sizes.join(" · ")
  return label.length <= maxChars ? label : label.slice(0, maxChars - 1) + "…"
}

/**
 * Returns the clean catalog "front" shot for the variant.
 * Order of preference:
 *   1. first image classified as "front" that isn't in `exclude`
 *   2. if image[0] is "other" (unrecognized suffix) and not excluded, use it
 *      — by Medusa convention image #1 is the catalog thumbnail, almost always
 *      a front shot uploaded without the canonical suffix
 *   3. null — real/detail/size_chart shots are explicitly NEVER used as front
 *
 * The `exclude` set is how multi-color templates (product-2colors/3colors) get
 * DIFFERENT fronts for each color slot when the catalog uses shared image
 * lists across variants (e.g. all colors share `[IS1587-red.jpg, IS1587-blue.jpg]`).
 * Without exclusion the picker returned the SAME front for every color.
 */
function pickFront(
  variant: SnapshotVariant | undefined,
  exclude: ReadonlySet<string> = EMPTY_SET,
): string | null {
  if (!variant || variant.image_urls.length === 0) return null
  for (const url of variant.image_urls) {
    if (exclude.has(url)) continue
    if (classifyImageKind(url) === "front") return url
  }
  // Defensive fallback: Medusa thumbnail is usually image[0]. If it doesn't
  // match our convention but isn't a known role suffix, take it as the front
  // — unless it's already been claimed by another color slot.
  const first = variant.image_urls[0]
  if (!exclude.has(first) && classifyImageKind(first) === "other") {
    return first
  }
  return null
}

const EMPTY_SET: ReadonlySet<string> = new Set()

/**
 * Returns the clean "-b" back shot for the variant, or null. NEVER returns a
 * real/detail/size_chart/other shot — that was the original bug.
 * The `exclude` set protects against a back URL colliding with a URL already
 * used as a front (defensive — only matters if a single URL ambiguously
 * classifies; with strict naming it never triggers).
 */
function pickBack(
  variant: SnapshotVariant | undefined,
  exclude: ReadonlySet<string> = EMPTY_SET,
): string | null {
  if (!variant) return null
  for (const url of variant.image_urls) {
    if (exclude.has(url)) continue
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
  exclude: ReadonlySet<string> = EMPTY_SET,
): string | null {
  for (let i = 0; i < colors.length; i++) {
    if (i === exceptIndex) continue
    const back = pickBack(colors[i], exclude)
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
 * Returns the best image to plug into the lifestyle-overlay template.
 *
 * Per boutique policy (set 2026-05-19): real / on-model shots (`-r`, `-real`)
 * are NEVER used in any story template. The lifestyle-overlay template kept
 * its name for continuity but uses a clean front shot — the visual treatment
 * (overlay typography, gradient) is what differentiates it from in-stock-hero,
 * not the underlying image kind.
 */
function pickLifestyle(colors: SnapshotVariant[]): string | null {
  return pickFront(colors[0])
}

function productNameLabel(snapshot: ProductSnapshot, maxChars: number): string {
  const n = snapshot.name.trim()
  if (n.length <= maxChars) return n
  return n.slice(0, maxChars - 1).trimEnd() + "…"
}

function colorLabel(variant: SnapshotVariant | undefined, maxChars: number): string | null {
  const raw = variant?.color?.trim()
  if (!raw) return null
  if (raw.length <= maxChars) return raw
  return raw.slice(0, maxChars - 1).trimEnd() + "…"
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
      // Auto-compute the savings %. Floor the % so we never overstate the
      // discount. Only set when there's a real saving (compare_at > price).
      const oldP = snapshot.compare_at_price_mur
      if (oldP != null && oldP > snapshot.price_mur && snapshot.price_mur > 0) {
        const pct = Math.floor(((oldP - snapshot.price_mur) / oldP) * 100)
        if (pct > 0) out.discount_pct = `-${pct}%`
      }
      if (sku) out.sku = sku
      return out
    }
    case "in-stock-hero":
    case "in-stock-hero-blush":
    case "in-stock-hero-cream":
    case "editorial-cover-hero": {
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
    case "cutout-spotlight":
    case "cutout-spotlight-v2": {
      out.price = price
      out.size = collectSizes(snapshot, 28)
      if (sku) out.sku = sku
      return out
    }
    case "bigprice-cutout-hero": {
      out.price = price
      out.size = collectSizes(snapshot, 28)
      out.headline = productNameLabel(snapshot, 24)
      if (sku) out.sku = sku
      return out
    }
    case "just-arrived-editorial": {
      out.price = price
      out.size = collectSizes(snapshot, 28)
      out.product_name = productNameLabel(snapshot, 28)
      if (sku) out.sku = sku
      return out
    }
    case "new-drop-arch":
    case "new-drop-arch-blush":
    case "new-drop-arch-cream":
    case "new-drop-arch-sage":
    case "new-drop-arch-coral": {
      out.price = price
      out.size = collectSizes(snapshot, 28)
      out.headline = productNameLabel(snapshot, 28)
      if (sku) out.sku = sku
      return out
    }
    case "split-thirds-editorial":
    case "receipt-tag-1color":
    case "framed-gallery-1color": {
      out.price = price
      out.size = collectSizes(snapshot, 28)
      out.headline = productNameLabel(snapshot, 22)
      if (sku) out.sku = sku
      return out
    }
    case "cardflip-front-back":
    case "lookbook-spread-back":
    case "filmstrip-multiframe": {
      out.price = price
      out.size = collectSizes(snapshot, 28)
      out.headline = productNameLabel(snapshot, 24)
      if (sku) out.sku = sku
      return out
    }
    case "color-mood-rail": {
      out.price = price
      // Per-color size pills — variants_in_stock[0..2] map to color_a/b/c slots
      // in the rail layout, so each color shows its OWN available sizes.
      const colors = snapshot.variants_in_stock
      out.size_a = sizesForVariant(colors[0], 22)
      out.size_b = sizesForVariant(colors[1], 22)
      out.size_c = sizesForVariant(colors[2], 22)
      out.product_name = productNameLabel(snapshot, 28)
      const a = colorLabel(colors[0], 18)
      const b = colorLabel(colors[1], 18)
      const c = colorLabel(colors[2], 18)
      if (a) out.color_a_label = a
      if (b) out.color_b_label = b
      if (c) out.color_c_label = c
      if (sku) out.sku = sku
      return out
    }
    case "product-2colors":
    case "product-2colors-blush":
    case "product-2colors-cream":
    case "product-2colors-sage":
    case "product-2colors-coral":
    case "product-2colors-front":
    case "swipe-through-2color": {
      // Per-color size pills — variants_in_stock[0..1] match the front_a/front_b
      // slots that pickTemplate fills below, so the size badge on each card
      // reflects ONLY that color's in-stock sizes.
      const colors = snapshot.variants_in_stock
      out.price = price
      out.size_a = sizesForVariant(colors[0], 22)
      out.size_b = sizesForVariant(colors[1], 22)
      if (sku) out.sku = sku
      return out
    }
    case "product-3colors": {
      // Per-color size pills for the 2x2 grid — variants_in_stock[0..2] map to
      // front_a/b/c slots.
      const colors = snapshot.variants_in_stock
      out.price = price
      out.size_a = sizesForVariant(colors[0], 22)
      out.size_b = sizesForVariant(colors[1], 22)
      out.size_c = sizesForVariant(colors[2], 22)
      if (sku) out.sku = sku
      return out
    }
    case "new-arrival":
    case "product-1color":
    case "product-1color-blush":
    case "product-1color-cream":
    case "product-1color-sage":
    case "product-1color-coral":
    case "product-1color-featured":
    case "product-1color-featured-blush":
    case "product-1color-featured-cream":
    case "product-1color-featured-sage":
    case "product-1color-featured-coral":
    case "many-photos": {
      out.price = price
      out.size = collectSizes(snapshot, 28)
      if (sku) out.sku = sku
      return out
    }
    default:
      // Unknown slug → empty overrides means the template renders with its
      // `default` placeholder values (Rs.0 / IS0000 / etc). Loud warn so a
      // missed switch arm shows up in render logs instead of shipping
      // garbage. Hit 2026-05-26 when 13 palette-variant slugs (product-1color-
      // blush/cream/sage/coral, product-1color-featured-*, new-drop-arch-*,
      // product-2colors-*) were added to templates but not to this switch.
      console.warn(
        `[stories-picker] buildTextOverrides: no case for slug "${slug}" — rendering with template defaults (likely Rs.0 / IS0000). Add a switch arm.`,
      )
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
 *   1. compare_at_price set + above current price → "on-sale" (exempt from cap)
 *   2. 3+ colors with backs → "product-3colors" (exempt from cap — only
 *      template that can show 3 colors at once)
 *   3. 2 colors → "product-2colors" / "product-2colors-front" (capped)
 *   4. 1 color with front + back → rotate ONE_COLOR_FRONT_BACK_ROTATION
 *      (capped; picks least-used template in the pool when cap map present)
 *   5. otherwise rotate the single-image pool [in-stock-hero, lifestyle-overlay,
 *      cutout-spotlight, …] picking the least-used for the day
 *
 * Per-day diversity (when `pickedSoFar` is provided): all capped templates
 * are limited to MAX_TEMPLATE_PER_DAY. When at cap, the picker falls through
 * to the next decision branch so the feed doesn't show the same template
 * 3+ times in one day.
 *
 * Returns null when there's no usable front image — e.g. variants only have
 * real/detail/size_chart shots. Callers (batch render) skip the slot in that
 * case rather than push an off-template story.
 */
export function pickTemplate(
  snapshot: ProductSnapshot | null,
  slotIndex: number,
  pickedSoFar?: Map<string, number>,
): PickedRender | null {
  if (!snapshot) return null
  const colors = snapshot.variants_in_stock
  if (colors.length === 0) return null

  // Gate everything on having at least one usable front-class image.
  // pickFront enforces "no real/detail/size_chart used as front" — if it
  // returns null we have nothing to put on a stock-style story.
  const leadFront = pickFront(colors[0])
  if (!leadFront) return null

  // Daily cutout guarantee — runs BEFORE every other branch, but ONLY for
  // single-color products. Until 2026-05-26 this lived at the bottom of the
  // function inside the single-image fallback, so any product with 2+ colors
  // / back image / on-sale / new-arrival returned via its native branch first
  // and never reached cutout (verified 2026-05-26: 4/7 cutout-eligible slots,
  // 0 cutouts picked). Promoted up so the first single-color cutout-eligible
  // product of the day claims cutout-spotlight, hijacking on-sale / new-arrival
  // / 1-color-front-back. Multi-color products are intentionally excluded —
  // cutout-spotlight is an editorial single-product layout; multi-color
  // products belong in product-2colors / product-3colors / color-mood-rail.
  // Cost: days where every cutout-eligible product is multi-color ship zero
  // cutouts. Tradeoff accepted 2026-05-26.
  const cutoutUrlEarly = pickCutout(colors)
  if (pickedSoFar && cutoutUrlEarly && colors.length === 1) {
    const CUTOUT_ROTATION = ["cutout-spotlight", "cutout-spotlight-v2", "bigprice-cutout-hero"] as const
    const cutoutCount =
      countOf(pickedSoFar, "cutout-spotlight") +
      countOf(pickedSoFar, "cutout-spotlight-v2") +
      countOf(pickedSoFar, "bigprice-cutout-hero")
    if (cutoutCount === 0) {
      const cutoutSlug = leastUsed(CUTOUT_ROTATION, pickedSoFar)
      return {
        template_slug: cutoutSlug,
        slot_inputs: { product_cutout: cutoutUrlEarly },
        text_overrides: buildTextOverrides(cutoutSlug, snapshot),
      }
    }
  }

  // on-sale is exempt from the cap — sales are rare and high-value; capping
  // them would mean hiding a price drop from the feed.
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

  // 3+ colors. Both templates in THREE_COLOR_ROTATION are exempt from the cap
  // — capping multi-color stories would misrepresent products with 3+ colors.
  // Rotation order:
  //   - back available → round-robin product-3colors ↔ color-mood-rail
  //     (color-mood-rail ignores the back; product-3colors needs it)
  //   - no back available → force color-mood-rail (front-only layout)
  if (colors.length >= 3) {
    const a = leadFront
    const b = pickFront(colors[1], new Set([a]))
    const fronts3 = new Set([a, b].filter((x): x is string => !!x))
    const c = pickFront(colors[2], fronts3)
    if (a && b && c) {
      const usedFor3 = new Set([a, b, c])
      const back =
        pickBack(colors[0], usedFor3) ??
        pickBackFromAnyOther(colors, 0, usedFor3)

      // If no back exists, color-mood-rail is the only valid 3-color layout.
      if (!back) {
        return {
          template_slug: "color-mood-rail",
          slot_inputs: { hero: a, color_a: a, color_b: b, color_c: c },
          text_overrides: buildTextOverrides("color-mood-rail", snapshot),
        }
      }

      // Rotate when a back is available. With pickedSoFar use least-used so
      // both templates land roughly evenly; otherwise alternate by slotIndex
      // parity (test back-compat — old tests expected product-3colors).
      const slug = pickedSoFar
        ? leastUsed(THREE_COLOR_ROTATION, pickedSoFar)
        : slotIndex % 2 === 0
          ? "product-3colors"
          : "color-mood-rail"

      if (slug === "color-mood-rail") {
        return {
          template_slug: "color-mood-rail",
          slot_inputs: { hero: a, color_a: a, color_b: b, color_c: c },
          text_overrides: buildTextOverrides("color-mood-rail", snapshot),
        }
      }
      return {
        template_slug: "product-3colors",
        slot_inputs: { front_a: a, front_b: b, front_c: c, back },
        text_overrides: buildTextOverrides("product-3colors", snapshot),
      }
    }
  }

  if (colors.length >= 2) {
    const a = leadFront
    // Exclude `a` so the 2-colors template never gets two identical fronts when
    // the catalog has shared image lists across variants (e.g. IS1587 jumpsuit
    // has [red.jpg, red-b.jpg, blue.jpg, blue-b.jpg] on BOTH color rows).
    const b = pickFront(colors[1], new Set([a]))
    const usedFor2 = new Set([a, b].filter((x): x is string => !!x))
    const back =
      pickBack(colors[0], usedFor2) ??
      pickBackFromAnyOther(colors, 0, usedFor2)
    if (
      a &&
      b &&
      back &&
      TWO_COLOR_BACK_ROTATION.some((s) => !isSaturated(pickedSoFar, s))
    ) {
      // Palette rotation across the 5 siblings. With pickedSoFar use least-used
      // so the feed alternates colours; otherwise fall back to slotIndex
      // deterministic rotation (test back-compat — old tests expected
      // product-2colors as the default head).
      const slug = pickedSoFar
        ? leastUsed(TWO_COLOR_BACK_ROTATION, pickedSoFar)
        : TWO_COLOR_BACK_ROTATION[
            slotIndex % TWO_COLOR_BACK_ROTATION.length
          ]
      return {
        template_slug: slug,
        slot_inputs: { front_a: a, front_b: b, back },
        text_overrides: buildTextOverrides(slug, snapshot),
      }
    }
    if (a && b && TWO_COLOR_FRONT_ROTATION.some((sg) => !isSaturated(pickedSoFar, sg))) {
      const slug = pickedSoFar
        ? leastUsed(TWO_COLOR_FRONT_ROTATION, pickedSoFar)
        : TWO_COLOR_FRONT_ROTATION[slotIndex % TWO_COLOR_FRONT_ROTATION.length]
      return {
        template_slug: slug,
        slot_inputs: { front_a: a, front_b: b },
        text_overrides: buildTextOverrides(slug, snapshot),
      }
    }
    // All 2-color templates saturated OR no distinct second front available
    // → fall through to 1-color / rotation.
  }

  const leadBack = pickBack(colors[0], new Set([leadFront]))
  if (
    leadBack &&
    ONE_COLOR_FRONT_BACK_ROTATION.some((s) => !isSaturated(pickedSoFar, s))
  ) {
    // Prefer least-used in the rotation when caller passes the count map;
    // otherwise stay deterministic by slotIndex parity (test back-compat).
    const slug = pickedSoFar
      ? leastUsed(ONE_COLOR_FRONT_BACK_ROTATION, pickedSoFar)
      : ONE_COLOR_FRONT_BACK_ROTATION[
          slotIndex % ONE_COLOR_FRONT_BACK_ROTATION.length
        ]
    return {
      template_slug: slug,
      slot_inputs: { front: leadFront, back: leadBack },
      text_overrides: buildTextOverrides(slug, snapshot),
    }
  }

  // Single photo, single color: prefer new-arrival when it actually IS new,
  // else fall back to the rotation pool for variety. new-arrival is exempt —
  // it's gated on is_new_arrival which is a product fact.
  if (snapshot.is_new_arrival) {
    return {
      template_slug: "new-arrival",
      slot_inputs: { hero: leadFront },
      text_overrides: buildTextOverrides("new-arrival", snapshot),
    }
  }

  // Build the rotation pool dynamically. cutout-spotlight joins the pool
  // whenever a -cutout PNG is available. Until 2026-05-25 there was an
  // additional `!hasRealShot()` gate (the rationale: real-shot products were
  // "stronger" as lifestyle-overlay). That rationale died with the 2026-05-19
  // policy that real shots are NEVER used in any story template — lifestyle-
  // overlay now uses front shots like every other template. The gate was
  // silently suppressing cutout-spotlight on most of the catalog (most
  // products have a -real upload), so it was removed.
  const cutoutUrl = pickCutout(colors)
  const cutoutEligible = cutoutUrl != null
  // Both cutout-spotlight (v1, cream/blush soft) and cutout-spotlight-v2
  // (bold blush circle + italic-script typography) are valid layouts for
  // any product with a cutout. Both share the same `product_cutout` slot
  // contract and same text_overrides — picker rotates between them on
  // separate slot indexes so the daily feed alternates the two looks.
  const pool: readonly string[] = cutoutEligible
    ? [...SINGLE_IMAGE_ROTATION, "cutout-spotlight", "cutout-spotlight-v2", "bigprice-cutout-hero"]
    : SINGLE_IMAGE_ROTATION

  // (The daily cutout guarantee runs at the top of pickTemplate now — see
  // comment near line 442. Down here cutout-spotlight just sits in the
  // single-image rotation pool alongside the other 1-photo templates so a
  // 1-color-no-back-no-newarrival product can still pick it naturally if the
  // guarantee already claimed today's cutout from someone else.)

  // When the caller passes a per-day count map, prefer the least-used template
  // in the pool. Without it, fall back to the deterministic slotIndex rotation
  // so the function stays pure-by-default for tests that don't care about caps.
  const slug = pickedSoFar
    ? leastUsed(pool, pickedSoFar)
    : pool[slotIndex % pool.length]
  if ((slug === "cutout-spotlight" || slug === "cutout-spotlight-v2" || slug === "bigprice-cutout-hero") && cutoutUrl) {
    return {
      template_slug: slug,
      slot_inputs: { product_cutout: cutoutUrl },
      text_overrides: buildTextOverrides(slug, snapshot),
    }
  }
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
