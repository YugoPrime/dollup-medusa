import { buildSnapshot, type ProductLike, type ProductSnapshot } from "./snapshot"

/** Metadata keys that describe a slot's rendered video. */
const RENDER_KEYS = ["render", "render_error", "render_started_at"] as const

/**
 * Slot metadata without its render, so the old product's video can never be
 * published and the renderer (which skips slots that already have one) makes a
 * new video for the slot's new product.
 */
function withoutRender(metadata: unknown): Record<string, unknown> {
  const copy = { ...((metadata ?? {}) as Record<string, unknown>) }
  for (const key of RENDER_KEYS) delete copy[key]
  return copy
}

type SlotLike = { id: string; pick_attempt?: number | null; metadata?: unknown }

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
  metadata: Record<string, unknown>
} {
  return {
    id: slot.id,
    product_id: product.id,
    product_snapshot: buildSnapshot(product),
    fallback_used: false,
    pick_attempt: (slot.pick_attempt ?? 1) + 1,
    metadata: withoutRender(slot.metadata),
  }
}

/** Update for a slot left with no product: nothing renders, nothing posts. */
export function clearSlotProductUpdate(slot: SlotLike): {
  id: string
  product_id: null
  product_snapshot: null
  metadata: Record<string, unknown>
} {
  return { id: slot.id, product_id: null, product_snapshot: null, metadata: withoutRender(slot.metadata) }
}
