import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"

import { FEED_POSTS_MODULE } from "../modules/feed-posts"
import type FeedPostsModuleService from "../modules/feed-posts/service"
import { STORIES_MODULE } from "../modules/stories"
import type StoriesModuleService from "../modules/stories/service"
import { planGridPostForDate } from "./grid-planner"
import { createStoryPickDeps } from "./story-pick-deps"
import { repickStorySlotsHolding, type RepickedSlot } from "./story-repick"
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
  /** Unposted story slots that held the product, now re-picked or emptied. */
  story_slots: RepickedSlot[]
}

/**
 * The owner's "keep off social" switch. Turning it on also replans every
 * upcoming grid post that featured the product and re-picks every unposted
 * story slot holding it (their new videos render on the next renderer run).
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

  // Stories already planned (and usually already rendered) with this product:
  // re-pick them now, dropping the old video, so it can't post.
  const story_slots = await repickStorySlotsHolding({
    stories: scope.resolve<StoriesModuleService>(STORIES_MODULE),
    deps: createStoryPickDeps(scope),
    productId,
    fromMs: Date.parse(`${today}T00:00:00+04:00`),
  })

  return { replanned_dates, story_slots }
}
