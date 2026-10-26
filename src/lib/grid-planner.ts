import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { FEED_POSTS_MODULE } from "../modules/feed-posts"
import type FeedPostsModuleService from "../modules/feed-posts/service"
import type { FeedPostDTO } from "../modules/feed-posts/service"
import { STORIES_MODULE } from "../modules/stories"
import { activeFocusTag } from "../modules/stories/focus"
import { DEFAULT_WEIGHTING } from "../modules/stories/picker-weighting"
import { collectCategoryAndDescendants } from "../modules/stories/product-source"
import type StoriesModuleService from "../modules/stories/service"
import { buildSnapshot } from "../modules/stories/snapshot"
import {
  buildFeedCaption,
  readFeedCaptionOptionsFromEnv,
  selectFeedImages,
} from "./feed-post-content"
import {
  nextRotationKey,
  pickGridProduct,
  ROTATION,
  type RotationKey,
} from "./grid-rotation"
import { addDaysToMauritiusDate } from "./mauritius-date"
import { createStoryPickDeps } from "./story-pick-deps"

/** Days of grid-post history considered when ordering repeats. */
const HISTORY_DAYS = 400
const DEFAULT_DEDUP_DAYS = 30
/** Grid posts are kept planned this many days ahead for the owner to review. */
export const GRID_HORIZON_DAYS = 7

type Scope = MedusaContainer

/**
 * Rotation category of the latest grid row strictly before `postDate`, or
 * null (no earlier row, or it had none) — the caller then starts at dresses.
 */
export function resolveRotationStart(
  rows: Array<{ post_date: string; metadata: Record<string, unknown> | null }>,
  postDate: string,
): string | null {
  let latest: (typeof rows)[number] | null = null
  for (const r of rows) {
    if (r.post_date < postDate && (!latest || r.post_date > latest.post_date)) latest = r
  }
  const cat = latest?.metadata?.rotation_category
  return typeof cat === "string" ? cat : null
}

async function listCategories(
  scope: Scope,
): Promise<Array<{ id: string; handle: string; parent_category_id: string | null }>> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_category",
    fields: ["id", "handle", "parent_category_id"],
    pagination: { take: 1000 },
  })
  return data as Array<{ id: string; handle: string; parent_category_id: string | null }>
}

/** Category id of each rotation handle. Throws if one is missing. */
export async function categoryIdsForHandles(scope: Scope): Promise<Record<RotationKey, string>> {
  const cats = await listCategories(scope)
  const out = {} as Record<RotationKey, string>
  for (const key of ROTATION) {
    const cat = cats.find((c) => c.handle === key)
    if (!cat) throw new Error(`Product category "${key}" not found`)
    out[key] = cat.id
  }
  return out
}

/** Each rotation category's id plus all its descendants (e.g. Beachwear → Bikini Sets). */
export async function rotationCategorySets(scope: Scope): Promise<Record<RotationKey, Set<string>>> {
  const cats = await listCategories(scope)
  const ids = await categoryIdsForHandles(scope)
  const out = {} as Record<RotationKey, Set<string>>
  for (const key of ROTATION) out[key] = new Set(collectCategoryAndDescendants(cats, ids[key]))
  return out
}

/** Product ids in the story plan for `date` (any slot, posted or not). */
export async function storyProductIdsForDate(scope: Scope, date: string): Promise<string[]> {
  const stories = scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const plans = await stories.listStoryPlans({ plan_date: date } as any, { take: 1 })
  if (plans.length === 0) return []
  const slots = await stories.listStorySlots({ plan_id: plans[0].id })
  return slots.map((s) => s.product_id).filter((id): id is string => Boolean(id))
}

export type PlanGridResult =
  | { ok: true; row: FeedPostDTO; rotation: RotationKey }
  | { ok: false; reason: "exists" | "no_eligible_product" }

/**
 * Plans the grid post for `postDate`: next category in the rotation (moving on
 * to the following one when a category has nothing), product chosen by
 * pickGridProduct. Never a product in that day's stories or in
 * `excludeProductIds`. Writes a `planned` row tagged with its rotation category.
 */
export async function planGridPostForDate(args: {
  scope: Scope
  postDate: string
  excludeProductIds?: string[]
}): Promise<PlanGridResult> {
  const { scope, postDate } = args
  const feed = scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const stories = scope.resolve<StoriesModuleService>(STORIES_MODULE)

  if (await feed.findByDate(postDate)) return { ok: false, reason: "exists" }

  const history = await feed.listSince(addDaysToMauritiusDate(postDate, -HISTORY_DAYS))
  // Planned rows count too, so a product already lined up this week isn't
  // planned a second time.
  const lastGridDateByProduct = new Map<string, string>()
  for (const r of history) {
    if (!r.product_id || r.status === "skipped") continue
    const prev = lastGridDateByProduct.get(r.product_id)
    if (!prev || r.post_date > prev) lastGridDateByProduct.set(r.product_id, r.post_date)
  }

  const excluded = new Set([
    ...(args.excludeProductIds ?? []),
    ...(await storyProductIdsForDate(scope, postDate)),
  ])
  const settings = await stories.getSettings()
  const focusTag = activeFocusTag(settings, postDate)
  const weighting = {
    collection_boost: settings.collection_boost ?? DEFAULT_WEIGHTING.collection_boost,
    collection_boost_days: settings.collection_boost_days ?? DEFAULT_WEIGHTING.collection_boost_days,
  }
  const dedupSince = addDaysToMauritiusDate(
    postDate,
    -(Number(process.env.FEED_DEDUP_DAYS) || DEFAULT_DEDUP_DAYS),
  )
  const { productSource } = createStoryPickDeps(scope)
  const categoryIds = await categoryIdsForHandles(scope)
  const captionOpts = readFeedCaptionOptionsFromEnv()
  const now = Date.now()

  let key = nextRotationKey(resolveRotationStart(history, postDate))
  for (let i = 0; i < ROTATION.length; i++, key = nextRotationKey(key)) {
    const candidates = (await productSource({ category_id: categoryIds[key] })).filter(
      (p) =>
        p.variants.some((v) => v.inventory_quantity > 0) &&
        selectFeedImages(buildSnapshot(p)).length > 0,
    )
    const product = pickGridProduct({
      candidates,
      focusTag,
      lastGridDateByProduct,
      excluded,
      dedupSince,
      weighting,
      now,
    })
    if (!product) continue

    const snapshot = buildSnapshot(product)
    const row = await feed.createPlanned({
      post_date: postDate,
      product_id: product.id,
      product_snapshot: snapshot,
      image_urls: selectFeedImages(snapshot),
      caption: buildFeedCaption(snapshot, captionOpts),
      metadata: { rotation_category: key, auto: true },
    })
    return { ok: true, row, rotation: key }
  }
  return { ok: false, reason: "no_eligible_product" }
}

/**
 * Keeps the next `days` days (tomorrow onward) planned. Days that already have
 * a row are left alone; planned one at a time, in order, so each day's
 * rotation follows the previous one.
 */
export async function planUpcomingGridPosts(args: {
  scope: Scope
  today: string
  days?: number
}): Promise<{ planned: string[]; empty: string[] }> {
  const feed = args.scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const days = args.days ?? GRID_HORIZON_DAYS
  const planned: string[] = []
  const empty: string[] = []
  for (let i = 1; i <= days; i++) {
    const date = addDaysToMauritiusDate(args.today, i)
    if (await feed.findByDate(date)) continue
    const result = await planGridPostForDate({ scope: args.scope, postDate: date })
    if (result.ok) planned.push(date)
    else if (result.reason === "no_eligible_product") empty.push(date)
  }
  return { planned, empty }
}
