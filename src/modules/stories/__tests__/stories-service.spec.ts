import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { STORIES_MODULE } from "../index"
import StoriesModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<StoriesModuleService>({
  moduleName: STORIES_MODULE,
  resolve: "./src/modules/stories",
  testSuite: ({ service }) => {
    describe("StoriesModuleService — settings", () => {
      it("getSettings returns defaults on first call", async () => {
        const s = await service.getSettings()
        expect(s.anti_repeat_days).toBe(7)
        expect(s.caption_template).toContain("{name}")
        expect(s.default_distribution).toEqual([])
        expect(s.default_schedule).toEqual([])
      })

      it("getSettings is idempotent", async () => {
        const a = await service.getSettings()
        const b = await service.getSettings()
        expect(a.id).toBe(b.id)
      })

      it("updateSettings merges partial input", async () => {
        await service.getSettings()
        const updated = await service.updateSettings({ anti_repeat_days: 14 })
        expect(updated.anti_repeat_days).toBe(14)
        expect(updated.caption_template).toContain("{name}")
      })
    })

    describe("StoriesModuleService — plans", () => {
      it("createPlan computes total_slots from distribution and creates empty slots", async () => {
        const plan = await service.createPlan({
          plan_date: "2026-06-01",
          category_distribution: [
            { category_id: "cat_dresses", count: 2 },
            { category_id: "cat_beach", count: 1 },
          ],
          scheduled_times: ["09:00", "13:00", "17:00"],
        })
        expect(plan.total_slots).toBe(3)
        expect(plan.status).toBe("draft")
        const slots = await service.listStorySlots({ plan_id: plan.id })
        expect(slots).toHaveLength(0)
      })

      it("createPlan rejects when total_slots !== scheduled_times.length", async () => {
        await expect(
          service.createPlan({
            plan_date: "2026-06-02",
            category_distribution: [{ category_id: "c", count: 3 }],
            scheduled_times: ["09:00", "13:00"],
          }),
        ).rejects.toThrow(/scheduled_times length/i)
      })

      it("createPlan enforces UNIQUE(plan_date)", async () => {
        await service.createPlan({
          plan_date: "2026-06-03",
          category_distribution: [{ category_id: "c", count: 1 }],
          scheduled_times: ["09:00"],
        })
        await expect(
          service.createPlan({
            plan_date: "2026-06-03",
            category_distribution: [{ category_id: "c", count: 1 }],
            scheduled_times: ["10:00"],
          }),
        ).rejects.toThrow()
      })
    })

    describe("StoriesModuleService — mark/unmark", () => {
      async function makePlanWithSlot(date: string) {
        const plan = await service.createPlan({
          plan_date: date,
          category_distribution: [{ category_id: "c1", count: 1 }],
          scheduled_times: ["09:00"],
        })
        const slot = await service.createStorySlots({
          plan_id: plan.id,
          slot_index: 0,
          scheduled_at: new Date(`${date}T09:00:00+04:00`),
          category_id: "c1",
          product_id: "prod_test",
          product_snapshot: {
            name: "Test",
            handle: "test",
            price_mur: 100,
            compare_at_price_mur: null,
            variants_in_stock: [],
            variant_in_stock_count: 0,
            picked_at: new Date().toISOString(),
          },
          fallback_used: false,
          pick_attempt: 1,
        })
        return { plan, slot }
      }

      it("markPosted stamps posted_at, writes a publication_log row, transitions plan to completed when all slots done", async () => {
        const { plan, slot } = await makePlanWithSlot("2026-07-01")
        await service.markPosted(slot.id)

        const reloadedSlot = (await service.listStorySlots({ id: slot.id }))[0]
        expect(reloadedSlot.posted_at).toBeTruthy()

        const logs = await service.listPublicationLogs({ slot_id: slot.id })
        expect(logs).toHaveLength(1)
        expect(logs[0].product_id).toBe("prod_test")

        const reloadedPlan = (await service.listStoryPlans({ id: plan.id }))[0]
        expect(reloadedPlan.status).toBe("completed")
      })

      it("unmark deletes the publication_log row and reverts status if it was completed", async () => {
        const { plan, slot } = await makePlanWithSlot("2026-07-02")
        await service.markPosted(slot.id)
        await service.unmark(slot.id)

        const reloadedSlot = (await service.listStorySlots({ id: slot.id }))[0]
        expect(reloadedSlot.posted_at).toBeNull()

        const logs = await service.listPublicationLogs({ slot_id: slot.id })
        expect(logs).toHaveLength(0)

        const reloadedPlan = (await service.listStoryPlans({ id: plan.id }))[0]
        expect(reloadedPlan.status).toBe("active")
      })

      it("markPosted refuses if slot has no product_id", async () => {
        const plan = await service.createPlan({
          plan_date: "2026-07-03",
          category_distribution: [{ category_id: "c", count: 1 }],
          scheduled_times: ["09:00"],
        })
        const empty = await service.createStorySlots({
          plan_id: plan.id,
          slot_index: 0,
          scheduled_at: new Date("2026-07-03T09:00:00+04:00"),
          category_id: "c",
          product_id: null,
          product_snapshot: null,
          fallback_used: false,
          pick_attempt: 1,
        })
        await expect(service.markPosted(empty.id)).rejects.toThrow(/no product/i)
      })
    })

    describe("StoriesModuleService — anti-repeat", () => {
      it("getExcludedProductIds returns products with publication_log within window", async () => {
        const now = Date.now()
        const dayAgo = new Date(now - 1 * 24 * 3600 * 1000)
        const tenDaysAgo = new Date(now - 10 * 24 * 3600 * 1000)

        await service.createPublicationLogs({ product_id: "prod_recent", posted_at: dayAgo })
        await service.createPublicationLogs({ product_id: "prod_old", posted_at: tenDaysAgo })

        const excluded = await service.getExcludedProductIds(7)
        expect(excluded).toContain("prod_recent")
        expect(excluded).not.toContain("prod_old")
      })

      it("getExcludedProductIds dedupes when same product was posted multiple times", async () => {
        const now = Date.now()
        await service.createPublicationLogs({ product_id: "prod_dup", posted_at: new Date(now - 1000) })
        await service.createPublicationLogs({ product_id: "prod_dup", posted_at: new Date(now - 2000) })

        const excluded = await service.getExcludedProductIds(7)
        const dupCount = excluded.filter((id) => id === "prod_dup").length
        expect(dupCount).toBe(1)
      })
    })
  },
})
