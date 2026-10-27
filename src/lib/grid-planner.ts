import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, QueryContext } from "@medusajs/framework/utils"

import { FEED_POSTS_MODULE } from "../modules/feed-posts"
import type FeedPostsModuleService from "../modules/feed-posts/service"
import type { FeedPostDTO } from "../modules/feed-posts/service"
import { STORIES_MODULE } from "../modules/stories"
import { activeFocusTag } from "../modules/stories/focus"
import { DEFAULT_WEIGHTING } from "../modules/stories/picker-weighting"
import {
  collectCategoryAndDescendants,
  isSocialExcluded,
  STORY_PRODUCT_FIELDS,
  toProductLike,
} from "../modules/stories/product-source"
import type StoriesModuleService from "../modules/stories/service"
import { buildSnapshot, type ProductLike } from "../modules/stories/snapshot"
import {
  buildFeedCaption,
  readFeedCaptionOptionsFromEnv,
  selectFeedImages,
} from "./feed-post-content"
import {
  gridRowProblem,
  nextRotationKey,
  pickGridProduct,
  refreshGridContent,
  ROTATION,
  type GridRowProblem,
  type RotationKey,
} from "./grid-rotation"
import { addDaysToMauritiusDate } from "./mauritius-date"
import { isUniqueViolation } from "./db-errors"
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

/** Everything the grid pick reads, loaded once per planning run. */
export type GridContext = {
  /** Grid rows (any status) from the last HISTORY_DAYS days onward, incl. planned. */
  history: Array<{
    post_date: string
    product_id: string | null
    status: string
    metadata: Record<string, unknown> | null
  }>
  /** Per rotation category: in-stock, social-eligible products with feed photos. */
  candidatesByKey: Record<RotationKey, ProductLike[]>
  settings: {
    focus_tag?: string | null
    focus_until?: string | null
    collection_boost?: number | null
    collection_boost_days?: number | null
  }
  dedupDays: number
}

/**
 * The grid pick for `postDate`: next category in the rotation (moving on when
 * a category has nothing), product chosen by pickGridProduct. Every row in the
 * history — planned ones included — counts as a post, so a product lined up
 * later this week isn't planned twice.
 */
export function chooseGridForDate(
  ctx: GridContext,
  postDate: string,
  excluded: Set<string>,
  now: number,
  rng?: () => number,
): { product: ProductLike; rotation: RotationKey } | null {
  const lastGridDateByProduct = new Map<string, string>()
  for (const r of ctx.history) {
    if (!r.product_id || r.status === "skipped") continue
    const prev = lastGridDateByProduct.get(r.product_id)
    if (!prev || r.post_date > prev) lastGridDateByProduct.set(r.product_id, r.post_date)
  }
  const weighting = {
    collection_boost: ctx.settings.collection_boost ?? DEFAULT_WEIGHTING.collection_boost,
    collection_boost_days: ctx.settings.collection_boost_days ?? DEFAULT_WEIGHTING.collection_boost_days,
  }
  const focusTag = activeFocusTag(ctx.settings, postDate)
  const dedupSince = addDaysToMauritiusDate(postDate, -ctx.dedupDays)

  let key = nextRotationKey(resolveRotationStart(ctx.history, postDate))
  for (let i = 0; i < ROTATION.length; i++, key = nextRotationKey(key)) {
    const product = pickGridProduct({
      candidates: ctx.candidatesByKey[key],
      focusTag,
      lastGridDateByProduct,
      excluded,
      dedupSince,
      weighting,
      now,
      rng,
    })
    if (product) return { product, rotation: key }
  }
  return null
}

/** Loads the grid context for planning around `today` (one product-source pass per category). */
export async function loadGridContext(scope: Scope, today: string): Promise<GridContext> {
  const feed = scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const stories = scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const { productSource } = createStoryPickDeps(scope)
  const categoryIds = await categoryIdsForHandles(scope)
  const candidatesByKey = {} as Record<RotationKey, ProductLike[]>
  for (const key of ROTATION) {
    candidatesByKey[key] = (await productSource({ category_id: categoryIds[key] })).filter(
      (p) =>
        p.variants.some((v) => v.inventory_quantity > 0) &&
        selectFeedImages(buildSnapshot(p)).length > 0,
    )
  }
  return {
    history: await feed.listSince(addDaysToMauritiusDate(today, -HISTORY_DAYS)),
    candidatesByKey,
    settings: await stories.getSettings(),
    dedupDays: Number(process.env.FEED_DEDUP_DAYS) || DEFAULT_DEDUP_DAYS,
  }
}

/**
 * Plans the grid post for `postDate` (see chooseGridForDate), never a product
 * in that day's stories or in `excludeProductIds`, and writes a `planned` row
 * tagged with its rotation category. Pass `ctx` to reuse one loaded context
 * across several days; the new row is appended to its history.
 */
export async function planGridPostForDate(args: {
  scope: Scope
  postDate: string
  excludeProductIds?: string[]
  ctx?: GridContext
}): Promise<PlanGridResult> {
  const { scope, postDate } = args
  const feed = scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)

  if (await feed.findByDate(postDate)) return { ok: false, reason: "exists" }

  const ctx = args.ctx ?? (await loadGridContext(scope, postDate))
  const excluded = new Set([
    ...(args.excludeProductIds ?? []),
    ...(await storyProductIdsForDate(scope, postDate)),
  ])
  const choice = chooseGridForDate(ctx, postDate, excluded, Date.now())
  if (!choice) return { ok: false, reason: "no_eligible_product" }

  const snapshot = buildSnapshot(choice.product)
  let row: FeedPostDTO
  try {
    row = await feed.createPlanned({
      post_date: postDate,
      product_id: choice.product.id,
      product_snapshot: snapshot,
      image_urls: selectFeedImages(snapshot),
      caption: buildFeedCaption(snapshot, readFeedCaptionOptionsFromEnv()),
      metadata: { rotation_category: choice.rotation, auto: true },
    })
  } catch (err) {
    // Another writer planned this date between our check and insert.
    if (isUniqueViolation(err)) return { ok: false, reason: "exists" }
    throw err
  }
  ctx.history.push(row)
  return { ok: true, row, rotation: choice.rotation }
}

/**
 * Keeps the next `days` days (tomorrow onward) planned. Days that already have
 * a row are left alone; planned one at a time, in order, from one shared
 * context so each day's rotation follows the previous one.
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
  let ctx: GridContext | null = null
  for (let i = 1; i <= days; i++) {
    const date = addDaysToMauritiusDate(args.today, i)
    if (await feed.findByDate(date)) continue
    ctx = ctx ?? (await loadGridContext(args.scope, args.today))
    const result = await planGridPostForDate({ scope: args.scope, postDate: date, ctx })
    if (result.ok) planned.push(date)
    else if (result.reason === "no_eligible_product") empty.push(date)
  }
  return { planned, empty }
}

/**
 * One product as the grid sees it, whatever its status: unlike the product
 * source this also returns unpublished and social-excluded products, so the
 * caller can say *why* one can't be posted.
 */
export async function loadGridProduct(
  scope: Scope,
  productId: string,
): Promise<{ product: ProductLike | null; published: boolean; socialExcluded: boolean }> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: [...STORY_PRODUCT_FIELDS, "status"],
    filters: { id: productId },
    pagination: { take: 1 },
    context: {
      variants: { calculated_price: QueryContext({ currency_code: "mur" }) },
    },
  })
  const raw = (data as any[])[0]
  if (!raw) return { product: null, published: false, socialExcluded: false }
  return {
    product: toProductLike(raw),
    published: raw.status === "published",
    socialExcluded: isSocialExcluded(raw),
  }
}

/**
 * Checks today's grid row against the live product: why it can't go out (or
 * null), and — when it can — its refreshed content (live price/sizes, only the
 * reviewed photos still on the product). No reviewed photo left = "no_photos".
 */
export async function inspectGridRow(
  scope: Scope,
  row: { product_id: string | null; image_urls: string[] | null },
  date: string,
): Promise<{
  problem: GridRowProblem | null
  refreshed: ReturnType<typeof refreshGridContent>
}> {
  const loaded = row.product_id
    ? await loadGridProduct(scope, row.product_id)
    : { product: null, published: false, socialExcluded: false }
  const problem = gridRowProblem({
    product: loaded.product,
    published: loaded.published,
    socialExcluded: loaded.socialExcluded,
    storyProductIds: new Set(await storyProductIdsForDate(scope, date)),
  })
  if (problem || !loaded.product) return { problem, refreshed: null }
  const refreshed = refreshGridContent(row.image_urls ?? [], loaded.product)
  return refreshed ? { problem: null, refreshed } : { problem: "no_photos", refreshed: null }
}
