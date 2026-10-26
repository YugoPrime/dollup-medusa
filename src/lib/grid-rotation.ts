import { hasTag } from "../modules/stories/focus"
import {
  pickWeightedProduct,
  type WeightingConfig,
} from "../modules/stories/picker-weighting"
import { buildSnapshot, type ProductLike, type ProductSnapshot } from "../modules/stories/snapshot"
import {
  buildFeedCaption,
  readFeedCaptionOptionsFromEnv,
  selectFeedImages,
  type FeedCaptionOptions,
} from "./feed-post-content"

/**
 * Pure rules for the daily IG/FB grid post: which category comes next and
 * which product in it. The impure planner (grid-planner.ts) only gathers data
 * and calls these.
 */

/** Category handles the grid rotates through, in order. */
export const ROTATION = ["dresses", "lingerie", "beachwear"] as const
export type RotationKey = (typeof ROTATION)[number]

/** The category after `prev`; anything outside the rotation restarts at dresses. */
export function nextRotationKey(prev: string | null | undefined): RotationKey {
  const i = ROTATION.indexOf(prev as RotationKey)
  return i < 0 ? ROTATION[0] : ROTATION[(i + 1) % ROTATION.length]
}

/** Which rotation category a product belongs to (via its category ids), if any. */
export function rotationKeyForProduct(
  categoryIds: string[],
  idsByKey: Record<RotationKey, Set<string>>,
): RotationKey | null {
  for (const key of ROTATION) {
    if (categoryIds.some((id) => idsByKey[key].has(id))) return key
  }
  return null
}

/**
 * Picks the grid product among `candidates` (already in stock, social-eligible
 * and with feed photos):
 *   1. focus pieces never posted on the grid, at random;
 *   2. else the focus piece posted longest ago (second round);
 *   3. else older stock not posted since `dedupSince`, recency-weighted;
 *   4. else null.
 * Dates are "YYYY-MM-DD" strings, compared lexically.
 */
export function pickGridProduct(args: {
  candidates: ProductLike[]
  focusTag: string | null
  lastGridDateByProduct: Map<string, string>
  excluded: Set<string>
  dedupSince: string
  weighting: WeightingConfig
  now: number
  rng?: () => number
}): ProductLike | null {
  const rng = args.rng ?? Math.random
  const pool = args.candidates.filter((p) => !args.excluded.has(p.id))
  const last = (p: ProductLike) => args.lastGridDateByProduct.get(p.id)

  if (args.focusTag) {
    const focus = pool.filter((p) => hasTag(p, args.focusTag as string))
    const never = focus.filter((p) => last(p) == null)
    if (never.length > 0) {
      return never[Math.min(never.length - 1, Math.floor(rng() * never.length))]
    }
    if (focus.length > 0) {
      return focus.reduce((oldest, p) => ((last(p) as string) < (last(oldest) as string) ? p : oldest))
    }
  }

  const stale = pool.filter((p) => {
    const d = last(p)
    return d == null || d < args.dedupSince
  })
  return pickWeightedProduct(stale, args.weighting, args.now, rng)
}

export type GridRowProblem =
  | "missing"
  | "unpublished"
  | "sold_out"
  | "off_social"
  | "in_stories"
  | "no_photos"

/** Why a planned grid product can no longer go out today, or null if it can. */
export function gridRowProblem(args: {
  product: ProductLike | null
  storyProductIds: Set<string>
  socialExcluded: boolean
  published: boolean
}): GridRowProblem | null {
  if (!args.product) return "missing"
  if (!args.published) return "unpublished"
  if (!args.product.variants.some((v) => v.inventory_quantity > 0)) return "sold_out"
  if (args.socialExcluded) return "off_social"
  if (args.storyProductIds.has(args.product.id)) return "in_stories"
  return null
}

/**
 * The post as it goes out today: the owner reviewed the photos days ago, but
 * price, sizes and colours come from the live product. Keeps only reviewed
 * photos still on an in-stock variant (in the reviewed order); null when none
 * is left, which the caller treats as "can't post as reviewed".
 */
export function refreshGridContent(
  reviewedImages: string[],
  product: ProductLike,
  captionOpts: FeedCaptionOptions = readFeedCaptionOptionsFromEnv(),
): { product_snapshot: ProductSnapshot; image_urls: string[]; caption: string } | null {
  const snapshot = buildSnapshot(product)
  const live = new Set(selectFeedImages(snapshot))
  const image_urls = reviewedImages.filter((u) => live.has(u))
  if (image_urls.length === 0) return null
  return { product_snapshot: snapshot, image_urls, caption: buildFeedCaption(snapshot, captionOpts) }
}

/**
 * What to do with today's planned or failed row once it has been inspected:
 * a planned row that can't go out is replaced; a failed one is never retried
 * with a product that can't go out (the day is skipped and the owner told).
 */
export function stepAfterInspection(
  status: "planned" | "failed",
  problem: GridRowProblem | null,
): "publish" | "replace" | "skip_with_alert" {
  if (!problem) return "publish"
  return status === "planned" ? "replace" : "skip_with_alert"
}
