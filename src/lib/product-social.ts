import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"

import { FEED_POSTS_MODULE } from "../modules/feed-posts"
import type FeedPostsModuleService from "../modules/feed-posts/service"
import { STORIES_MODULE } from "../modules/stories"
import type StoriesModuleService from "../modules/stories/service"
import { planGridPostForDate } from "./grid-planner"
import { mauritiusToday } from "./mauritius-date"

/** Copy of `metadata` with `no_social` set; every other key is kept. */
export function mergeSocialFlag(
  metadata: Record<string, unknown> | null,
  noSocial: boolean,
): Record<string, unknown> {
  return { ...(metadata ?? {}), no_social: noSocial }
}

export type SocialFlagResult = {
  replanned_dates: string[]
  story_slots: Array<{ slot_id: string; plan_date: string; scheduled_at: string }>
}

/**
 * The owner's "keep off social" switch. Turning it on also replans every
 * upcoming grid post that featured the product, and lists the unposted story
 * slots still holding it so the owner can swap them.
 */
export async function setProductNoSocial(
  scope: MedusaContainer,
  productId: string,
  noSocial: boolean,
): Promise<SocialFlagResult> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "metadata"],
    filters: { id: productId },
    pagination: { take: 1 },
  })
  const product = (data as Array<{ id: string; metadata: Record<string, unknown> | null }>)[0]
  if (!product) throw new Error(`Product ${productId} not found`)

  // Full merged metadata, so replace-or-merge semantics give the same result.
  await updateProductsWorkflow(scope as never).run({
    input: {
      selector: { id: productId },
      update: { metadata: mergeSocialFlag(product.metadata, noSocial) },
    },
  })

  if (!noSocial) return { replanned_dates: [], story_slots: [] }

  const today = mauritiusToday()
  const feed = scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const replanned_dates: string[] = []
  const upcoming = (await feed.listSince(today))
    .filter((r) => r.status === "planned" && r.product_id === productId)
    .sort((a, b) => a.post_date.localeCompare(b.post_date))
  for (const r of upcoming) {
    await feed.deletePlannedByDate(r.post_date)
    await planGridPostForDate({ scope, postDate: r.post_date, excludeProductIds: [productId] })
    replanned_dates.push(r.post_date)
  }

  const stories = scope.resolve<StoriesModuleService>(STORIES_MODULE)
  const slots = (await stories.listStorySlots({ product_id: productId, posted_at: null } as any)).filter(
    (s) => new Date(s.scheduled_at as unknown as string).getTime() >= Date.parse(`${today}T00:00:00+04:00`),
  )
  const plans = slots.length
    ? await stories.listStoryPlans({ id: Array.from(new Set(slots.map((s) => s.plan_id))) } as any)
    : []
  const dateByPlan = new Map(
    plans.map((p) => {
      const pd = p.plan_date as unknown as string | Date
      return [p.id, typeof pd === "string" ? pd.slice(0, 10) : pd.toISOString().slice(0, 10)]
    }),
  )
  const story_slots = slots.map((s) => ({
    slot_id: s.id,
    plan_date: dateByPlan.get(s.plan_id) ?? "",
    scheduled_at: new Date(s.scheduled_at as unknown as string).toISOString(),
  }))

  return { replanned_dates, story_slots }
}
