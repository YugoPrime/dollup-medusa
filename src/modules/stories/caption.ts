import type { ProductSnapshot } from "./snapshot"

export const STOREFRONT_BASE_URL =
  process.env.STORIES_STOREFRONT_BASE_URL ?? "https://shop.dollupboutique.com"

const MUR_FORMAT = new Intl.NumberFormat("en-US", { useGrouping: true })

/**
 * Renders the caption template against a snapshot.
 * Tokens:
 *   {name}                — product name
 *   {price}               — price_mur formatted with thousands separator
 *   {compare_at_price}    — compare_at_price_mur formatted, empty if null
 *   {sizes}               — deduped in-stock sizes joined by "/"
 *   {link}                — storefront URL using snapshot.handle
 */
export function renderCaption(template: string, snap: ProductSnapshot): string {
  const sizes = Array.from(
    new Set(snap.variants_in_stock.flatMap((v) => v.sizes)),
  ).join("/")
  const compareAt =
    snap.compare_at_price_mur != null ? MUR_FORMAT.format(snap.compare_at_price_mur) : ""
  const replacements: Record<string, string> = {
    "{name}": snap.name,
    "{price}": MUR_FORMAT.format(snap.price_mur),
    "{compare_at_price}": compareAt,
    "{sizes}": sizes,
    "{link}": `${STOREFRONT_BASE_URL}/products/${snap.handle}`,
  }
  return Object.entries(replacements).reduce(
    (acc, [k, v]) => acc.replaceAll(k, v),
    template,
  )
}
