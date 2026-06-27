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

  const items = (await (sourcing as any).listDraftItems(
    { published_product_id: { $ne: null } },
    { take: 2000 },
  )) as DraftItemRow[]

  if (items.length === 0) {
    res.json({ pushed_at: null, products: [] })
    return
  }

  // Latest push = max published_at; group that day's items by their draft order
  // is overkill — take the items pushed within the same 6h window as the newest.
  const withTime = items
    .filter((i) => i.published_product_id && i.published_at)
    .map((i) => ({ ...i, t: new Date(i.published_at as string).getTime() }))
    .sort((a, b) => b.t - a.t)

  if (withTime.length === 0) {
    res.json({ pushed_at: null, products: [] })
    return
  }
  const newest = withTime[0].t
  const WINDOW_MS = 6 * 60 * 60 * 1000
  const latest = withTime.filter((i) => newest - i.t <= WINDOW_MS)
  const productIds = latest.map((i) => i.published_product_id as string)
  const refById = new Map(latest.map((i) => [i.published_product_id as string, i.ref]))

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

  res.json({ pushed_at: new Date(newest).toISOString(), products: out })
}
