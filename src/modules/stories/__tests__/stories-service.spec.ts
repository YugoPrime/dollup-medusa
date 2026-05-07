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
  },
})
