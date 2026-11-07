import { buildSnapshot, type ProductLike, type ProductSnapshot } from "./snapshot"

/**
 * Metadata keys that describe a slot's rendered video. A swap removes them via
 * dropRenderKeysSql (Medusa's update merges metadata, so omission would keep them).
 * `render_unsent_alert` is the sweep's "still unsent" Telegram claim, so the new
 * product can alert again.
 */
export const RENDER_KEYS = [
  "render",
  "render_error",
  "render_started_at",
  "render_job",
  "render_shadow",
  "render_unsent_alert",
] as const

type SlotLike = { id: string; pick_attempt?: number | null }

/** Update for putting `product` on an unposted slot (manual swap or re-pick). */
export function swapSlotUpdate(
  slot: SlotLike,
  product: ProductLike,
): {
  id: string
  product_id: string
  product_snapshot: ProductSnapshot
  fallback_used: boolean
  pick_attempt: number
} {
  return {
    id: slot.id,
    product_id: product.id,
    product_snapshot: buildSnapshot(product),
    fallback_used: false,
    pick_attempt: (slot.pick_attempt ?? 1) + 1,
  }
}

/** Update for a slot left with no product: nothing renders, nothing posts. */
export function clearSlotProductUpdate(slot: SlotLike): {
  id: string
  product_id: null
  product_snapshot: null
} {
  return { id: slot.id, product_id: null, product_snapshot: null }
}
