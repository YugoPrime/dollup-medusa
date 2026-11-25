export type WishlistEvent = {
  anonId: string
  customerId: string | null
  action: "add" | "remove"
  productIds: string[]
}

/** The storefront sends at most this many ids at once (its one-time catch-up chunks). */
export const MAX_PRODUCT_IDS = 200

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PRODUCT_ID = /^prod_[0-9A-Za-z]{10,40}$/
const CUSTOMER_ID = /^cus_[0-9A-Za-z]{10,40}$/

/**
 * Body of POST /store/wishlist-events:
 * { anon_id, customer_id?, action: "add" | "remove", product_ids: string[] }.
 * The route is public, so anything off-shape is refused before it is stored.
 */
export function parseWishlistEvent(body: unknown): { event: WishlistEvent } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.anon_id !== "string" || !UUID.test(b.anon_id)) {
    return { error: "anon_id must be a UUID" }
  }
  if (b.action !== "add" && b.action !== "remove") {
    return { error: 'action must be "add" or "remove"' }
  }
  const ids = b.product_ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_PRODUCT_IDS) {
    return { error: `product_ids must list 1 to ${MAX_PRODUCT_IDS} products` }
  }
  if (!ids.every((id) => typeof id === "string" && PRODUCT_ID.test(id))) {
    return { error: "product_ids must be product ids" }
  }
  const customer = b.customer_id ?? null
  if (customer !== null && (typeof customer !== "string" || !CUSTOMER_ID.test(customer))) {
    return { error: "customer_id must be a customer id" }
  }
  return {
    event: {
      anonId: b.anon_id.toLowerCase(),
      customerId: customer,
      action: b.action,
      productIds: [...new Set(ids as string[])],
    },
  }
}
