import type { ProductLike } from "./snapshot"

/**
 * Configurable bias toward the newest / current collection in the auto picker.
 *
 * The boutique drops a fresh "collection" of products every few days. Pure
 * random selection treated a 6-month-old product the same as today's drop, so
 * a brand-new collection could go days without ever being featured in a story.
 * This weighting makes recently-created products proportionally more likely to
 * be picked, without ever excluding the back-catalog (so anti-repeat still has
 * room to breathe on quiet weeks).
 *
 * Recency is the proxy for "current collection": the storefront's collectionN
 * tag isn't reliably applied at import time, but `created_at` always is, so a
 * product created within `collection_boost_days` is treated as current.
 */
export type WeightingConfig = {
  /** Multiplier applied to in-window products. 1 = no boost (pure random). */
  collection_boost: number
  /** A product created within this many days counts as "current collection". */
  collection_boost_days: number
}

export const DEFAULT_WEIGHTING: WeightingConfig = {
  collection_boost: 3,
  collection_boost_days: 14,
}

const DAY_MS = 24 * 60 * 60 * 1000

function createdAtMs(product: Pick<ProductLike, "created_at">): number | null {
  const raw = product.created_at
  if (!raw) return null
  const t = typeof raw === "string" ? Date.parse(raw) : raw.getTime()
  return Number.isFinite(t) ? t : null
}

export function isWithinBoostWindow(
  product: Pick<ProductLike, "created_at">,
  windowDays: number,
  now: number,
): boolean {
  const t = createdAtMs(product)
  if (t == null) return false
  return now - t <= windowDays * DAY_MS
}

/**
 * Selection weight for a single product. Boosted products get
 * `collection_boost`; everything else gets 1. A boost <= 1 (or a product with
 * no usable created_at) collapses to uniform weighting.
 */
export function productWeight(
  product: Pick<ProductLike, "created_at">,
  config: WeightingConfig,
  now: number,
): number {
  const boost = Number.isFinite(config.collection_boost)
    ? Math.max(1, config.collection_boost)
    : 1
  if (boost <= 1) return 1
  return isWithinBoostWindow(product, config.collection_boost_days, now)
    ? boost
    : 1
}

/**
 * Picks an index in [0, weights.length) with probability proportional to each
 * weight. `rng()` must return a float in [0, 1). Returns -1 for an empty array.
 * Falls back to uniform when all weights are non-positive.
 */
export function weightedPickIndex(
  weights: number[],
  rng: () => number,
): number {
  if (weights.length === 0) return -1
  const total = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0)
  if (total <= 0) return Math.floor(rng() * weights.length)
  let r = rng() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i] > 0 ? weights[i] : 0
    if (r < 0) return i
  }
  return weights.length - 1
}

/**
 * Weighted random pick over products, biasing the current collection. Drop-in
 * replacement for a uniform `pickRandom` — returns null for an empty list.
 */
export function pickWeightedProduct<T extends Pick<ProductLike, "created_at">>(
  items: T[],
  config: WeightingConfig,
  now: number,
  rng: () => number = Math.random,
): T | null {
  if (items.length === 0) return null
  const weights = items.map((p) => productWeight(p, config, now))
  const idx = weightedPickIndex(weights, rng)
  return idx >= 0 ? items[idx] : null
}
