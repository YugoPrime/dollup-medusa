/**
 * Picks the thumbnail for a product variant out of its per-colour imagery.
 *
 * Variants carry their colour's shots in `metadata.image_urls` (written by the
 * sourcing push and the pre-order bookmarklet). Medusa's own
 * `prepareLineItemData` stamps a line item's thumbnail as
 * `variant.thumbnail ?? variant.product.thumbnail` — so a variant with a null
 * `thumbnail` column makes every colourway show the product's default shot.
 * That's how a "Yellow / L" line rendered the white dress in the cart drawer,
 * checkout, the order-placed email and the customer's order history.
 *
 * Populating `product_variant.thumbnail` at creation fixes all of those at
 * once, because they each read the snapshot Medusa took at add-to-cart time.
 */
export function pickVariantThumbnail(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const urls = (metadata ?? {}).image_urls
  if (!Array.isArray(urls)) return null
  for (const url of urls) {
    if (typeof url === "string" && url.trim()) return url
  }
  return null
}
