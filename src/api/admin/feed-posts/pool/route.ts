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

type DraftItemRow = {
  draft_order_id: string | null
  ref: string | null
  published_product_id: string | null
  published_at: Date | string | null
}

/**
 * GET /admin/feed-posts/pool
 * Products from the most recent sourcing push (the draft order whose items have
 * the newest published_at), each annotated with their published status and
 * whether they're already planned on an upcoming day.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
) => {
  const sourcing = req.scope.resolve<SourcingModuleService>(SOURCING_MODULE)
  const feed = req.scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const items = (await sourcing.listDraftItems(
    { published_product_id: { $ne: null } },
    { take: 2000 },
  )) as unknown as DraftItemRow[]

  const pushed = items.filter(
    (i) => i.published_product_id && i.published_at && i.draft_order_id,
  )
  if (pushed.length === 0) {
    res.json({ pushed_at: null, products: [] })
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
    fields: ["id", "title", "status", "thumbnail"],
    filters: { id: productIds },
  })

  // Upcoming planned rows → scheduled_date per product.
  const today = mauritiusToday()
  const horizon = addDaysToMauritiusDate(today, 120)
  const upcoming = await feed.listByDateRange(today, horizon)
  const scheduledByProduct = new Map<string, string>()
  for (const r of upcoming) {
    if (r.product_id && (r.status === "planned" || r.status === "posted")) {
      scheduledByProduct.set(r.product_id, r.post_date)
    }
  }

  const out = (products as Array<{ id: string; title: string; status: string; thumbnail: string | null }>).map(
    (p) => ({
      id: p.id,
      title: p.title,
      ref: refById.get(p.id) ?? null,
      thumbnail: p.thumbnail ?? null,
      status: p.status,
      scheduled_date: scheduledByProduct.get(p.id) ?? null,
    }),
  )

  res.json({ pushed_at: pushedAt, products: out })
}
