import { activeFocusTag } from "../modules/stories/focus"
import { DEFAULT_WEIGHTING } from "../modules/stories/picker-weighting"
import type { PickDeps } from "../modules/stories/service"
import { chooseSlotProduct } from "../modules/stories/slot-choice"
import type { ProductLike } from "../modules/stories/snapshot"

/** The slice of the stories service this needs (a fake in unit tests). */
export type RepickStories = {
  listStorySlots(filter: any, config?: any): Promise<any[]>
  listStoryPlans(filter: any, config?: any): Promise<any[]>
  getSettings(): Promise<{
    anti_repeat_days: number
    focus_tag?: string | null
    focus_until?: string | null
    collection_boost?: number | null
    collection_boost_days?: number | null
  }>
  getExcludedProductIds(days: number): Promise<string[]>
  swapSlotProduct(slotId: string, product: ProductLike): Promise<void>
  clearSlotProduct(slotId: string): Promise<void>
}

export type RepickedSlot = {
  slot_id: string
  plan_date: string
  scheduled_at: string
  /** Title of the product now on the slot; null = slot emptied (won't post). */
  replaced_with: string | null
}

function ymd(d: string | Date): string {
  return typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10)
}

/**
 * Re-picks every unposted story slot from `fromMs` onward that holds
 * `productId`, by the normal story rules (same category, new collection first,
 * never that day's other stories or grid post, never `productId`). Swapping
 * drops the slot's render, so the renderer makes a new video and the old one
 * can't post; a slot nothing can fill is emptied.
 */
export async function repickStorySlotsHolding(args: {
  stories: RepickStories
  deps: Required<PickDeps>
  productId: string
  fromMs: number
  now?: number
  rng?: () => number
}): Promise<RepickedSlot[]> {
  const { stories, deps, productId } = args
  const slots = (await stories.listStorySlots({ product_id: productId, posted_at: null })).filter(
    (s) => new Date(s.scheduled_at).getTime() >= args.fromMs,
  )
  if (slots.length === 0) return []

  const settings = await stories.getSettings()
  const antiRepeat = await stories.getExcludedProductIds(settings.anti_repeat_days)
  const weighting = {
    collection_boost: settings.collection_boost ?? DEFAULT_WEIGHTING.collection_boost,
    collection_boost_days: settings.collection_boost_days ?? DEFAULT_WEIGHTING.collection_boost_days,
  }
  const plans = await stories.listStoryPlans({ id: Array.from(new Set(slots.map((s) => s.plan_id))) })
  const dateByPlan = new Map(plans.map((p) => [p.id, ymd(p.plan_date)]))

  const out: RepickedSlot[] = []
  for (const slot of slots) {
    const planDate = dateByPlan.get(slot.plan_id) ?? ""
    const siblings = (await stories.listStorySlots({ plan_id: slot.plan_id }))
      .filter((s) => s.id !== slot.id && s.product_id)
      .map((s) => s.product_id as string)
    const { product } = await chooseSlotProduct({
      inCategory: await deps.productSource({ category_id: slot.category_id }),
      union: () => deps.productSource({}),
      excluded: new Set([...antiRepeat, ...siblings, productId]),
      gridExcluded: new Set(await deps.gridProductIdsForDate(planDate)),
      focusTag: activeFocusTag(settings, planDate),
      weighting,
      now: args.now ?? Date.now(),
      rng: args.rng,
    })
    if (product) await stories.swapSlotProduct(slot.id, product)
    else await stories.clearSlotProduct(slot.id)
    out.push({
      slot_id: slot.id,
      plan_date: planDate,
      scheduled_at: new Date(slot.scheduled_at).toISOString(),
      replaced_with: product ? product.title : null,
    })
  }
  return out
}
