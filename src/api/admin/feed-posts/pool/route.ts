import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { SOURCING_MODULE } from "../../../../modules/sourcing"
import type SourcingModuleService from "../../../../modules/sourcing/service"
import { FEED_POSTS_MODULE } from "../../../../modules/feed-posts"
import type FeedPostsModuleService from "../../../../modules/feed-posts/service"
import { mauritiusToday, addDaysToMauritiusDate } from "../../../../lib/mauritius-date"
import { rotationCategorySets } from "../../../../lib/grid-planner"
import { rotationKeyForProduct, type RotationKey } from "../../../../lib/grid-rotation"
import { STORIES_MODULE } from "../../../../modules/stories"
import { activeFocusTag } from "../../../../modules/stories/focus"
import type StoriesModuleService from "../../../../modules/stories/service"

type DraftItemRow = {
  draft_order_id: string | null
  ref: string | null
  published_product_id: string | null
  published_at: Date | string | null
}

type PoolSourceProduct = {
  id: string
  title: string
  handle: string
  status: string
  thumbnail: string | null
  metadata: Record<string, unknown> | null
  categories?: Array<{ id: string }> | null
}

const POOL_FIELDS = ["id", "title", "handle", "status", "thumbnail", "metadata", "categories.id"]

function toPoolProduct(
  p: PoolSourceProduct,
  ref: string | null,
  scheduledByProduct: Map<string, string>,
  sets: Record<RotationKey, Set<string>>,
) {
  return {
    id: p.id,
    title: p.title,
    ref,
    handle: p.handle ?? null,
    thumbnail: p.thumbnail ?? null,
    status: p.status,
    scheduled_date: scheduledByProduct.get(p.id) ?? null,
    rotation_category: rotationKeyForProduct((p.categories ?? []).map((c) => c.id), sets),
    no_social: p.metadata?.no_social === true,
  }
}

/**
 * GET /admin/feed-posts/pool
 * While a new-collection focus is active: every product carrying the focus tag
 * (any status). Otherwise: products from the most recent sourcing push (the
 * draft order whose items have the newest published_at). Each is annotated
 * with its status, rotation category, keep-off-social flag and whether it's
 * already planned on an upcoming day.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const sourcing = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  const feed = req.scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const stories = req.scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const today = mauritiusToday()
  const upcoming = await feed.listByDateRange(today, addDaysToMauritiusDate(today, 120))
  const scheduledByProduct = new Map<string, string>()
  for (const r of upcoming) {
    if (r.product_id && (r.status === "planned" || r.status === "posted")) {
      scheduledByProduct.set(r.product_id, r.post_date)
    }
  }
  const sets = await rotationCategorySets(req.scope)

  const focusTag = activeFocusTag(await stories.getSettings(), today)
  if (focusTag) {
    const { data: tags } = await query.graph({
      entity: "product_tag",
      fields: ["id", "value", "products.id"],
      pagination: { take: 1000 },
    })
    const ids = (tags as Array<{ value: string; products?: Array<{ id: string }> | null }>)
      .filter((t) => (t.value ?? "").trim().toLowerCase() === focusTag)
      .flatMap((t) => (t.products ?? []).map((p) => p.id))
    const { data: products } = ids.length
      ? await query.graph({ entity: "product", fields: POOL_FIELDS, filters: { id: ids } })
      : { data: [] }
    const out = (products as PoolSourceProduct[])
      .map((p) => toPoolProduct(p, (p.handle ?? "").toUpperCase() || null, scheduledByProduct, sets))
      .sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? "", undefined, { numeric: true }))
    res.json({ focus_tag: focusTag, pushed_at: null, products: out })
    return
  }

  const items = (await sourcing.listDraftItems(
    { published_product_id: { $ne: null } },
    { take: 2000 },
  )) as unknown as DraftItemRow[]

  const pushed = items.filter(
    (i) => i.published_product_id && i.published_at && i.draft_order_id,
  )
  if (pushed.length === 0) {
    res.json({ focus_tag: null, pushed_at: null, products: [] })
    return
  }

  // Most recent push = the draft order that contains the newest published item.
  // One push = one draft order, so grouping by draft_order_id captures exactly
  // that push's products regardless of how many seconds the items span.
  let newest = pushed[0]
  for (const i of pushed) {
    if (
      new Date(i.published_at as string).getTime() >
      new Date(newest.published_at as string).getTime()
    ) {
      newest = i
    }
  }
  const latestOrderId = newest.draft_order_id
  const latest = pushed.filter((i) => i.draft_order_id === latestOrderId)
  const productIds = latest.map((i) => i.published_product_id as string)
  const refById = new Map(
    latest.map((i) => [i.published_product_id as string, i.ref]),
  )
  const pushedAt = new Date(
    Math.max(...latest.map((i) => new Date(i.published_at as string).getTime())),
  ).toISOString()

  const { data: products } = await query.graph({
    entity: "product",
    fields: POOL_FIELDS,
    filters: { id: productIds },
  })

  const out = (products as PoolSourceProduct[]).map((p) =>
    toPoolProduct(p, refById.get(p.id) ?? null, scheduledByProduct, sets),
  )

  res.json({ focus_tag: null, pushed_at: pushedAt, products: out })
}
