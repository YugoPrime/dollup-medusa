import { ContainerRegistrationKeys, QueryContext } from "@medusajs/framework/utils"

import type { ProductLike } from "./snapshot"

/**
 * Returns the given category id plus the ids of every descendant category
 * (children, grandchildren, …) found in `cats` — a flat list of
 * `{ id, parent_category_id }` rows. The boutique nests its catalog (e.g.
 * "Beachwear" → Bikini Sets / Cover-Ups / One-Pieces), but the distribution
 * picks the parent. Without this expansion the picker only saw products tagged
 * directly to the parent, starving categories whose products live in children.
 *
 * Guards against cyclic parent references (returns each id once, no infinite
 * loop) and always includes `rootId` even if it isn't in `cats`.
 */
export function collectCategoryAndDescendants(
  cats: Array<{ id: string; parent_category_id?: string | null }>,
  rootId: string,
): string[] {
  const childrenByParent = new Map<string, string[]>()
  for (const c of cats) {
    const parent = c.parent_category_id ?? null
    if (parent == null) continue
    const arr = childrenByParent.get(parent) ?? []
    arr.push(c.id)
    childrenByParent.set(parent, arr)
  }

  const result = new Set<string>()
  const stack = [rootId]
  while (stack.length > 0) {
    const id = stack.pop()!
    if (result.has(id)) continue
    result.add(id)
    for (const child of childrenByParent.get(id) ?? []) {
      if (!result.has(child)) stack.push(child)
    }
  }
  return Array.from(result)
}

/**
 * Wires the stories picker to Medusa's product module via query.graph so the
 * pricing module's calculated_price + original_amount (a remote link) and the
 * inventory levels are traversed in one call.
 *
 * Returns a `productSource(filter)` function with the same signature
 * StoriesModuleService.regeneratePlan / createBatchPlans expect. Filters by
 * status=published and an optional `category_id` — which is expanded to include
 * all descendant categories so a parent like "Beachwear" pulls products from
 * its Bikini Sets / Cover-Ups / One-Pieces children. Skips Intimates products
 * (18+, marked unlisted) so the auto-planner never picks them.
 */
export function createMedusaProductSource(scope: {
  resolve(key: any): any
}): (filter: { category_id?: string }) => Promise<ProductLike[]> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  return async (filter) => {
    const filters: Record<string, unknown> = { status: "published" }
    if (filter.category_id) {
      // Expand the requested category to itself + all descendants so nested
      // catalogs (parent category, products in children) are picked up.
      const { data: cats } = await query.graph({
        entity: "product_category",
        fields: ["id", "parent_category_id"],
        pagination: { take: 1000 },
      })
      const ids = collectCategoryAndDescendants(
        cats as Array<{ id: string; parent_category_id?: string | null }>,
        filter.category_id,
      )
      // Array value on `categories` is an IN filter across category ids.
      filters.categories = ids
    }
    const { data: products } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "title",
        "handle",
        "created_at",
        "metadata",
        "images.url",
        "categories.handle",
        "variants.id",
        "variants.sku",
        "variants.title",
        "variants.manage_inventory",
        "variants.inventory_items.required_quantity",
        "variants.inventory_items.inventory.location_levels.stocked_quantity",
        "variants.inventory_items.inventory.location_levels.reserved_quantity",
        "variants.options.value",
        "variants.options.option.title",
        "variants.calculated_price.*",
      ],
      filters,
      pagination: { take: 500 },
      context: {
        variants: {
          calculated_price: QueryContext({ currency_code: "mur" }),
        },
      },
    })
    return (products as any[]).filter((p) => !isIntimatesProduct(p)).map(toProductLike)
  }
}

/**
 * Medusa v2 has no `inventory_quantity` on product_variant — stock lives in
 * the Inventory module, joined via inventory_items.inventory.location_levels.
 * Sum (stocked - reserved) across every level of every linked item; if the
 * variant is not inventory-managed, treat as effectively unlimited.
 */
export function computeInventoryQuantity(v: any): number {
  if (v.manage_inventory === false) return Number.MAX_SAFE_INTEGER
  let total = 0
  for (const ii of v.inventory_items ?? []) {
    for (const lvl of ii.inventory?.location_levels ?? []) {
      total += Number(lvl.stocked_quantity ?? 0) - Number(lvl.reserved_quantity ?? 0)
    }
  }
  return Math.max(0, total)
}

/**
 * A product is "Intimates" if any of its categories has the `intimates`
 * handle, OR if metadata.unlisted is true (treated as adult-tier).
 */
export function isIntimatesProduct(p: any): boolean {
  const cats: Array<{ handle?: string }> = p.categories ?? []
  if (cats.some((c) => (c?.handle ?? "").toLowerCase() === "intimates")) return true
  const meta = (p.metadata ?? null) as Record<string, unknown> | null
  if (meta && meta.unlisted === true) return true
  return false
}

/**
 * Boutique upload convention encodes the color in the filename:
 *   `<sku>-<size>-<color>-<role>.<ext>` e.g. `is1070-s-red-front.png`
 *   `<sku>-<color>-<role>.<ext>`        e.g. `IS2290-white-cutout.png`
 *   `<sku>-<color>.<ext>`               e.g. `is1070-red.jpg`
 *
 * Medusa v2 has no per-variant image relation by default — `product.images`
 * is a flat list on the parent. Without filtering, every variant would get
 * the full list, which breaks two things:
 *
 *   1. Per-color UI rows on the slot detail page show every image under
 *      every color (the user sees the same red image under both the RED and
 *      BLACK headings).
 *   2. The picker's multi-color templates (product-2colors / product-3colors)
 *      pick "front A" then exclude that URL and ask for "front B" — but both
 *      come from the same shared list, so the second-color front is just the
 *      next red front, not the black front.
 *
 * Returns true when the URL's filename contains the color token as a hyphen-
 * delimited segment. Case-insensitive. Empty / unknown color returns false
 * so the caller can fall back to the full list.
 */
function imageBelongsToColor(url: string, color: string): boolean {
  if (!color) return false
  const filename = url.split("?")[0].split("#")[0].split("/").pop() ?? ""
  const noExt = filename.replace(/\.[a-z0-9]+$/i, "")
  const segments = noExt.toLowerCase().split("-")
  return segments.includes(color.toLowerCase())
}

function partitionImagesForVariant(
  allImages: Array<{ url: string }>,
  variantColor: string | null,
): Array<{ url: string }> {
  if (!variantColor) return allImages
  const matched = allImages.filter((img) => imageBelongsToColor(img.url, variantColor))
  // Fallback: if the convention didn't catch any image for this color (older
  // products without color-encoded filenames), return the full list so the
  // picker still has something to work with rather than skipping the slot.
  return matched.length > 0 ? matched : allImages
}

export function toProductLike(p: any): ProductLike {
  // The cutout PNG is stored on product.metadata (NOT product.images) so it
  // stays out of the storefront gallery. We inject it into every variant's
  // images list so the picker / snapshot can see it and fire the
  // cutout-spotlight template. classifyImageKind recognises the `-cutout`
  // filename suffix.
  const metadata = (p.metadata ?? null) as Record<string, unknown> | null
  const cutoutUrl =
    typeof metadata?.cutout_image_url === "string" && metadata.cutout_image_url
      ? metadata.cutout_image_url
      : null

  const allBaseImages = (p.images ?? []).map((img: any) => ({ url: img.url }))

  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    created_at: p.created_at,
    variants: (p.variants ?? []).map((v: any) => {
      const calc = v.calculated_price
      const displayAmount = calc?.calculated_amount
      const amount = displayAmount != null ? Number(displayAmount) * 100 : null
      const prices =
        amount != null && Number.isFinite(amount)
          ? [{ amount, currency_code: String(calc?.currency_code ?? "mur") }]
          : []
      const originalDisplay = calc?.original_amount
      const compareAtAmount =
        originalDisplay != null ? Number(originalDisplay) * 100 : null

      const options = Object.fromEntries(
        (v.options ?? []).map((o: any) => [
          o.option?.title?.toLowerCase() ?? "opt",
          o.value,
        ]),
      )
      const variantColor = typeof options.color === "string" ? options.color : null
      const baseImages = partitionImagesForVariant(allBaseImages, variantColor)
      const images = cutoutUrl
        ? [...baseImages, { url: cutoutUrl }]
        : baseImages

      return {
        id: v.id,
        sku: v.sku,
        title: v.title,
        inventory_quantity: computeInventoryQuantity(v),
        prices,
        compare_at_amount:
          compareAtAmount != null && Number.isFinite(compareAtAmount)
            ? compareAtAmount
            : null,
        options,
        images,
      }
    }),
  }
}
