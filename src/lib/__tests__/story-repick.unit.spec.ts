import type { ProductLike } from "../../modules/stories/snapshot"
import { repickStorySlotsHolding } from "../story-repick"

function make(id: string, tags: string[] = []): ProductLike {
  return {
    id,
    title: id.toUpperCase(),
    handle: id,
    created_at: "2026-01-01T00:00:00Z",
    tags,
    variants: [
      {
        id: `${id}_v`,
        inventory_quantity: 2,
        prices: [{ amount: 100000, currency_code: "mur" }],
        options: { color: "Red", size: "M" },
      },
    ],
  }
}

function fakeStories(slots: any[]) {
  const swapped: Array<{ slot: string; product: string }> = []
  const cleared: string[] = []
  return {
    swapped,
    cleared,
    async listStorySlots(filter: any) {
      return slots.filter((s) =>
        Object.entries(filter).every(([k, v]) => (v === null ? s[k] == null : s[k] === v)),
      )
    },
    async listStoryPlans(filter: any) {
      const ids: string[] = Array.isArray(filter.id) ? filter.id : [filter.id]
      return ids.map((id) => ({ id, plan_date: id === "plan_tomorrow" ? "2026-11-04" : "2026-11-03" }))
    },
    async getSettings() {
      return { anti_repeat_days: 7, focus_tag: "collection30", focus_until: "2027-02-28", collection_boost: 3, collection_boost_days: 14 }
    },
    async getExcludedProductIds() {
      return ["recent"]
    },
    async swapSlotProduct(slotId: string, product: ProductLike) {
      swapped.push({ slot: slotId, product: product.id })
    },
    async clearSlotProduct(slotId: string) {
      cleared.push(slotId)
    },
  }
}

const FROM = Date.parse("2026-11-03T00:00:00+04:00")

describe("repickStorySlotsHolding", () => {
  it("re-picks an unposted slot holding the flagged product, skipping the day's other stories and grid post", async () => {
    const stories = fakeStories([
      { id: "s1", plan_id: "plan_tomorrow", category_id: "cat_l", product_id: "flagged", posted_at: null, scheduled_at: "2026-11-04T05:00:00Z" },
      { id: "s2", plan_id: "plan_tomorrow", category_id: "cat_l", product_id: "sibling", posted_at: null, scheduled_at: "2026-11-04T07:00:00Z" },
    ])
    const deps = {
      productSource: async () => [make("sibling", ["collection30"]), make("gridpick", ["collection30"]), make("fresh", ["collection30"]), make("recent", ["collection30"])],
      gridProductIdsForDate: async () => ["gridpick"],
    }
    const out = await repickStorySlotsHolding({ stories, deps, productId: "flagged", fromMs: FROM, rng: () => 0 })
    expect(stories.swapped).toEqual([{ slot: "s1", product: "fresh" }])
    expect(out).toEqual([
      { slot_id: "s1", plan_date: "2026-11-04", scheduled_at: "2026-11-04T05:00:00.000Z", replaced_with: "FRESH" },
    ])
  })

  it("empties the slot when nothing else can take it", async () => {
    const stories = fakeStories([
      { id: "s1", plan_id: "plan_today", category_id: "cat_l", product_id: "flagged", posted_at: null, scheduled_at: "2026-11-03T12:00:00Z" },
    ])
    const deps = { productSource: async () => [make("flagged")], gridProductIdsForDate: async () => [] }
    const out = await repickStorySlotsHolding({ stories, deps, productId: "flagged", fromMs: FROM })
    expect(stories.cleared).toEqual(["s1"])
    expect(out[0].replaced_with).toBeNull()
  })

  it("leaves past and posted slots alone", async () => {
    const stories = fakeStories([
      { id: "old", plan_id: "plan_today", category_id: "cat_l", product_id: "flagged", posted_at: null, scheduled_at: "2026-11-02T12:00:00Z" },
      { id: "done", plan_id: "plan_today", category_id: "cat_l", product_id: "flagged", posted_at: "2026-11-03T05:00:00Z", scheduled_at: "2026-11-03T05:00:00Z" },
    ])
    const deps = { productSource: async () => [make("fresh")], gridProductIdsForDate: async () => [] }
    const out = await repickStorySlotsHolding({ stories, deps, productId: "flagged", fromMs: FROM })
    expect(out).toEqual([])
    expect(stories.swapped).toEqual([])
  })
})
