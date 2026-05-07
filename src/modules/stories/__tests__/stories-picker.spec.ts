import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { STORIES_MODULE } from "../index"
import StoriesModuleService from "../service"
import type { ProductLike } from "../snapshot"

jest.setTimeout(60 * 1000)

type ProductSource = (filter: { category_id?: string }) => Promise<ProductLike[]>

const FLORAL: ProductLike = {
  id: "p_floral",
  title: "Floral Dress",
  handle: "floral-dress",
  variants: [
    {
      id: "v_floral_pink_s",
      sku: "FLR-PINK-S",
      title: "Pink/S",
      inventory_quantity: 3,
      prices: [{ amount: 129000, currency_code: "mur" }],
      options: { color: "Pink", size: "S" },
      images: [{ url: "https://r2/floral.jpg" }],
    },
  ],
}

const BIKINI: ProductLike = {
  id: "p_bikini",
  title: "Bikini",
  handle: "bikini",
  variants: [
    {
      id: "v_bikini_blue_m",
      sku: "BKN-BLUE-M",
      title: "Blue/M",
      inventory_quantity: 1,
      prices: [{ amount: 99000, currency_code: "mur" }],
      options: { color: "Blue", size: "M" },
      images: [{ url: "https://r2/bikini.jpg" }],
    },
  ],
}

moduleIntegrationTestRunner<StoriesModuleService>({
  moduleName: STORIES_MODULE,
  resolve: "./src/modules/stories",
  testSuite: ({ service }) => {
    describe("regeneratePlan", () => {
      it("fills slots with products from the requested categories, anti-repeat exclusion holds", async () => {
        const source: ProductSource = async ({ category_id }) => {
          if (category_id === "cat_dresses") return [FLORAL]
          if (category_id === "cat_beach") return [BIKINI]
          return []
        }
        const plan = await service.createPlan({
          plan_date: "2026-08-01",
          category_distribution: [
            { category_id: "cat_dresses", count: 1 },
            { category_id: "cat_beach", count: 1 },
          ],
          scheduled_times: ["09:00", "13:00"],
        })
        await service.regeneratePlan(plan.id, { productSource: source })

        const slots = (await service.listStorySlots({ plan_id: plan.id }))
          .sort((a, b) => a.slot_index - b.slot_index)
        expect(slots).toHaveLength(2)
        expect(slots[0].product_id).toBe("p_floral")
        expect(slots[1].product_id).toBe("p_bikini")
        expect(slots[0].fallback_used).toBe(false)
        expect(slots[1].fallback_used).toBe(false)
      })

      it("falls back to the union when a category bucket is empty", async () => {
        const source: ProductSource = async ({ category_id }) => {
          if (category_id === "cat_dresses") return [FLORAL]
          if (category_id === "cat_lingerie") return []
          return [FLORAL, BIKINI]
        }
        const plan = await service.createPlan({
          plan_date: "2026-08-02",
          category_distribution: [
            { category_id: "cat_dresses", count: 1 },
            { category_id: "cat_lingerie", count: 1 },
          ],
          scheduled_times: ["09:00", "13:00"],
        })
        await service.regeneratePlan(plan.id, { productSource: source })

        const slots = (await service.listStorySlots({ plan_id: plan.id }))
          .sort((a, b) => a.slot_index - b.slot_index)
        expect(slots[0].fallback_used).toBe(false)
        expect(slots[0].product_id).toBe("p_floral")
        expect(slots[1].fallback_used).toBe(true)
        expect(slots[1].product_id).toBe("p_bikini")
      })

      it("creates an empty slot when the union is also empty", async () => {
        const source: ProductSource = async () => []
        const plan = await service.createPlan({
          plan_date: "2026-08-03",
          category_distribution: [{ category_id: "x", count: 1 }],
          scheduled_times: ["09:00"],
        })
        await service.regeneratePlan(plan.id, { productSource: source })

        const slots = await service.listStorySlots({ plan_id: plan.id })
        expect(slots[0].product_id).toBeNull()
        expect(slots[0].product_snapshot).toBeNull()
      })

      it("does not re-pick products posted within anti_repeat_days", async () => {
        await service.updateSettings({ anti_repeat_days: 7 })
        await service.createPublicationLogs({
          product_id: "p_floral",
          posted_at: new Date(),
        })
        const source: ProductSource = async () => [FLORAL, BIKINI]
        const plan = await service.createPlan({
          plan_date: "2026-08-04",
          category_distribution: [{ category_id: "cat_any", count: 1 }],
          scheduled_times: ["09:00"],
        })
        await service.regeneratePlan(plan.id, { productSource: source })

        const slots = await service.listStorySlots({ plan_id: plan.id })
        expect(slots[0].product_id).toBe("p_bikini")
      })

      it("does not pick the same product twice in the same regenerate", async () => {
        const source: ProductSource = async () => [FLORAL]
        const plan = await service.createPlan({
          plan_date: "2026-08-05",
          category_distribution: [{ category_id: "cat_any", count: 2 }],
          scheduled_times: ["09:00", "13:00"],
        })
        await service.regeneratePlan(plan.id, { productSource: source })

        const slots = (await service.listStorySlots({ plan_id: plan.id }))
          .sort((a, b) => a.slot_index - b.slot_index)
        expect(slots[0].product_id).toBe("p_floral")
        expect(slots[1].product_id).toBeNull()
      })

      it("preserves posted slots and only re-rolls unposted ones", async () => {
        const source: ProductSource = async () => [FLORAL, BIKINI]
        const plan = await service.createPlan({
          plan_date: "2026-08-06",
          category_distribution: [{ category_id: "cat_any", count: 2 }],
          scheduled_times: ["09:00", "13:00"],
        })
        await service.regeneratePlan(plan.id, { productSource: source })
        const initial = (await service.listStorySlots({ plan_id: plan.id }))
          .sort((a, b) => a.slot_index - b.slot_index)
        await service.markPosted(initial[0].id)

        await service.regeneratePlan(plan.id, { productSource: source })
        const after = (await service.listStorySlots({ plan_id: plan.id }))
          .sort((a, b) => a.slot_index - b.slot_index)
        expect(after[0].id).toBe(initial[0].id)
        expect(after[0].posted_at).toBeTruthy()
        expect(after[1].id).not.toBe(initial[1].id)
      })

      it("rejects regenerate on a completed plan", async () => {
        const source: ProductSource = async () => [FLORAL]
        const plan = await service.createPlan({
          plan_date: "2026-08-07",
          category_distribution: [{ category_id: "cat_any", count: 1 }],
          scheduled_times: ["09:00"],
        })
        await service.regeneratePlan(plan.id, { productSource: source })
        const [slot] = await service.listStorySlots({ plan_id: plan.id })
        await service.markPosted(slot.id)

        await expect(service.regeneratePlan(plan.id, { productSource: source })).rejects.toThrow(
          /completed/i,
        )
      })

      it("transitions plan from draft to active after first successful regenerate", async () => {
        const source: ProductSource = async () => [FLORAL]
        const plan = await service.createPlan({
          plan_date: "2026-08-08",
          category_distribution: [{ category_id: "cat_any", count: 1 }],
          scheduled_times: ["09:00"],
        })
        await service.regeneratePlan(plan.id, { productSource: source })
        const [reloaded] = await service.listStoryPlans({ id: plan.id })
        expect(reloaded.status).toBe("active")
      })
    })
  },
})
