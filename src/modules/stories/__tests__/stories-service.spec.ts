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

      it("getSettings returns stock_alert_threshold = 0 by default", async () => {
        const s = await service.getSettings()
        expect(s.stock_alert_threshold).toBe(0)
      })

      it("updateSettings persists stock_alert_threshold", async () => {
        await service.getSettings()
        const updated = await service.updateSettings({ stock_alert_threshold: 3 })
        expect(updated.stock_alert_threshold).toBe(3)
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

      it("markPosted accepts filler slots (product_id=null) and skips the publication_log row", async () => {
        const plan = await service.createPlan({
          plan_date: "2026-07-03",
          category_distribution: [{ category_id: "c", count: 1 }],
          scheduled_times: ["09:00"],
        })
        const filler = await service.createStorySlots({
          plan_id: plan.id,
          slot_index: 0,
          scheduled_at: new Date("2026-07-03T09:00:00+04:00"),
          category_id: "__filler__",
          product_id: null,
          product_snapshot: null,
          fallback_used: false,
          pick_attempt: 1,
        })

        await service.markPosted(filler.id)

        const [reloaded] = await service.listStorySlots({ id: filler.id })
        expect(reloaded.posted_at).toBeInstanceOf(Date)
        const logs = await service.listPublicationLogs({ slot_id: filler.id })
        expect(logs).toHaveLength(0)
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

    describe("StoriesModuleService — rescheduleSlot", () => {
      it("updates scheduled_at on an unposted slot", async () => {
        const plan = await service.createPlan({
          plan_date: "2026-07-01",
          category_distribution: [{ category_id: "cat_a", count: 1 }],
          scheduled_times: ["09:00"],
        })
        const slot = await service.createStorySlots({
          plan_id: plan.id,
          slot_index: 0,
          scheduled_at: new Date("2026-07-01T09:00:00+04:00"),
          category_id: "cat_a",
          product_id: null,
          product_snapshot: null,
          fallback_used: false,
          pick_attempt: 1,
        } as never)
        const newAt = new Date("2026-07-01T15:30:00+04:00")
        await service.rescheduleSlot((slot as { id: string }).id, newAt)
        const [updated] = await service.listStorySlots({ id: (slot as { id: string }).id })
        expect(new Date(updated.scheduled_at).toISOString()).toBe(newAt.toISOString())
      })

      it("rejects rescheduling a posted slot", async () => {
        const plan = await service.createPlan({
          plan_date: "2026-07-02",
          category_distribution: [{ category_id: "cat_a", count: 1 }],
          scheduled_times: ["09:00"],
        })
        const slot = await service.createStorySlots({
          plan_id: plan.id,
          slot_index: 0,
          scheduled_at: new Date("2026-07-02T09:00:00+04:00"),
          category_id: "cat_a",
          product_id: "prod_x",
          product_snapshot: null,
          fallback_used: false,
          pick_attempt: 1,
          posted_at: new Date(),
        } as never)
        await expect(
          service.rescheduleSlot(
            (slot as { id: string }).id,
            new Date("2026-07-02T15:00:00+04:00"),
          ),
        ).rejects.toThrow(/posted/i)
      })
    })

    describe("StoriesModuleService — regeneratePlan baseline (refactor safety)", () => {
      it("fills slots from a small catalog under no anti-repeat exclusions", async () => {
        const plan = await service.createPlan({
          plan_date: "2026-08-01",
          category_distribution: [{ category_id: "cat_dresses", count: 2 }],
          scheduled_times: ["09:00", "13:00"],
        })
        const productSource = async () => [
          {
            id: "prod_a",
            title: "A",
            handle: "a",
            variants: [
              {
                id: "var_a",
                inventory_quantity: 5,
                prices: [{ amount: 50000, currency_code: "mur" }],
                options: { color: "Pink", size: "M" },
                images: [{ url: "https://x/a.jpg" }],
              },
            ],
          },
          {
            id: "prod_b",
            title: "B",
            handle: "b",
            variants: [
              {
                id: "var_b",
                inventory_quantity: 5,
                prices: [{ amount: 60000, currency_code: "mur" }],
                options: { color: "Blue", size: "S" },
                images: [{ url: "https://x/b.jpg" }],
              },
            ],
          },
        ]
        await service.regeneratePlan(plan.id, { productSource })
        const slots = (await service.listStorySlots({ plan_id: plan.id })).sort(
          (a, b) => a.slot_index - b.slot_index,
        )
        expect(slots).toHaveLength(2)
        expect(slots.every((s) => s.product_id != null)).toBe(true)
        // No same product in two slots within the plan
        const ids = slots.map((s) => s.product_id)
        expect(new Set(ids).size).toBe(2)
      })
    })

    describe("StoriesModuleService — getStockAlerts", () => {
      it("returns alerts for unposted slots whose product is at/below threshold", async () => {
        const plan = await service.createPlan({
          plan_date: "2026-11-01",
          category_distribution: [{ category_id: "cat_a", count: 2 }],
          scheduled_times: ["09:00", "13:00"],
        })
        await service.createStorySlots({
          plan_id: plan.id,
          slot_index: 0,
          scheduled_at: new Date("2026-11-01T09:00:00+04:00"),
          category_id: "cat_a",
          product_id: "prod_oos",
          product_snapshot: {
            name: "Out of stock dress",
            handle: "x",
            price_mur: 0,
            compare_at_price_mur: null,
            variants_in_stock: [],
            variant_in_stock_count: 0,
            picked_at: new Date().toISOString(),
          },
          fallback_used: false,
          pick_attempt: 1,
        } as never)
        await service.createStorySlots({
          plan_id: plan.id,
          slot_index: 1,
          scheduled_at: new Date("2026-11-01T13:00:00+04:00"),
          category_id: "cat_a",
          product_id: "prod_ok",
          product_snapshot: {
            name: "Healthy dress",
            handle: "y",
            price_mur: 0,
            compare_at_price_mur: null,
            variants_in_stock: [],
            variant_in_stock_count: 0,
            picked_at: new Date().toISOString(),
          },
          fallback_used: false,
          pick_attempt: 1,
        } as never)
        const stocks = new Map<string, number>([
          ["prod_oos", 0],
          ["prod_ok", 12],
        ])
        const alerts = await service.getStockAlerts({
          variantStockLookup: async (ids) =>
            new Map(ids.map((id) => [id, stocks.get(id) ?? 0])),
          fromDate: "2026-11-01",
          toDate: "2026-11-01",
        })
        expect(alerts).toHaveLength(1)
        expect(alerts[0].product_id).toBe("prod_oos")
        expect(alerts[0].current_stock).toBe(0)
      })

      it("excludes posted slots and respects threshold setting", async () => {
        await service.updateSettings({ stock_alert_threshold: 2 })
        const plan = await service.createPlan({
          plan_date: "2026-11-02",
          category_distribution: [{ category_id: "cat_a", count: 1 }],
          scheduled_times: ["09:00"],
        })
        await service.createStorySlots({
          plan_id: plan.id,
          slot_index: 0,
          scheduled_at: new Date("2026-11-02T09:00:00+04:00"),
          category_id: "cat_a",
          product_id: "prod_p",
          product_snapshot: null,
          fallback_used: false,
          pick_attempt: 1,
          posted_at: new Date(),
        } as never)
        const alerts = await service.getStockAlerts({
          variantStockLookup: async () => new Map([["prod_p", 0]]),
          fromDate: "2026-11-02",
          toDate: "2026-11-02",
        })
        expect(alerts).toHaveLength(0)  // posted, never alerts
      })
    })

    describe("StoriesModuleService — swapSlotProduct", () => {
      it("replaces product_id and snapshot on an unposted slot", async () => {
        const plan = await service.createPlan({
          plan_date: "2026-12-01",
          category_distribution: [{ category_id: "cat_a", count: 1 }],
          scheduled_times: ["09:00"],
        })
        const slot = await service.createStorySlots({
          plan_id: plan.id,
          slot_index: 0,
          scheduled_at: new Date("2026-12-01T09:00:00+04:00"),
          category_id: "cat_a",
          product_id: "prod_old",
          product_snapshot: null,
          fallback_used: true,
          pick_attempt: 1,
        } as never)
        const newProduct = {
          id: "prod_new",
          title: "Replacement Dress",
          handle: "replacement-dress",
          variants: [
            {
              id: "var_new",
              sku: null,
              title: null,
              inventory_quantity: 8,
              prices: [{ amount: 159000, currency_code: "mur" }],
              options: { color: "Cream", size: "M" },
              images: [{ url: "https://x/new.jpg" }],
            },
          ],
        }
        await service.swapSlotProduct((slot as { id: string }).id, newProduct)
        const [updated] = await service.listStorySlots({ id: (slot as { id: string }).id })
        expect(updated.product_id).toBe("prod_new")
        expect((updated.product_snapshot as { name?: string })?.name).toBe("Replacement Dress")
        expect(updated.fallback_used).toBe(false)
        expect(updated.pick_attempt).toBeGreaterThan(1)
      })

      it("rejects swapping on a posted slot", async () => {
        const plan = await service.createPlan({
          plan_date: "2026-12-02",
          category_distribution: [{ category_id: "cat_a", count: 1 }],
          scheduled_times: ["09:00"],
        })
        const slot = await service.createStorySlots({
          plan_id: plan.id,
          slot_index: 0,
          scheduled_at: new Date("2026-12-02T09:00:00+04:00"),
          category_id: "cat_a",
          product_id: "prod_old",
          product_snapshot: null,
          fallback_used: false,
          pick_attempt: 1,
          posted_at: new Date(),
        } as never)
        const stub = {
          id: "prod_new",
          title: "x",
          handle: "x",
          variants: [
            {
              id: "v",
              inventory_quantity: 1,
              prices: [{ amount: 100000, currency_code: "mur" }],
              options: { color: "x", size: "x" },
              images: [{ url: "https://x/x.jpg" }],
            },
          ],
        }
        await expect(
          service.swapSlotProduct((slot as { id: string }).id, stub),
        ).rejects.toThrow(/posted/i)
      })
    })

    describe("StoriesModuleService — createBatchPlans", () => {
      it("creates N plans with shared anti-repeat across the batch", async () => {
        const distribution = [{ category_id: "cat_a", count: 1 }]
        const times = ["09:00"]
        // catalog of 3 products — 3 days × 1 slot = 3 slots, no repeats
        const productSource = async () => [
          ["prod_x", "X"],
          ["prod_y", "Y"],
          ["prod_z", "Z"],
        ].map(([id, title]) => ({
          id,
          title,
          handle: id,
          variants: [
            {
              id: `var_${id}`,
              inventory_quantity: 5,
              prices: [{ amount: 100000, currency_code: "mur" }],
              options: { color: "Pink", size: "M" },
              images: [{ url: `https://x/${id}.jpg` }],
            },
          ],
        }))

        const plans = await service.createBatchPlans(
          {
            start_date: "2026-09-01",
            days: 3,
            category_distribution: distribution,
            scheduled_times: times,
          },
          { productSource },
        )

        expect(plans).toHaveLength(3)
        const allSlots = (
          await Promise.all(plans.map((p) => service.listStorySlots({ plan_id: p.id })))
        ).flat()
        expect(allSlots).toHaveLength(3)
        const ids = allSlots.map((s) => s.product_id).filter(Boolean)
        expect(ids.length).toBe(3)
        expect(new Set(ids).size).toBe(3) // no repeats across batch
      })

      it("uses the correct calendar dates starting from start_date", async () => {
        const productSource = async () => []
        const plans = await service.createBatchPlans(
          {
            start_date: "2026-09-01",
            days: 3,
            category_distribution: [{ category_id: "cat_a", count: 1 }],
            scheduled_times: ["09:00"],
          },
          { productSource },
        )
        const dates = plans.map((p) =>
          typeof p.plan_date === "string"
            ? p.plan_date.slice(0, 10)
            : (p.plan_date as Date).toISOString().slice(0, 10),
        )
        expect(dates).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"])
      })

      it("rejects overlap with an existing plan in the range", async () => {
        await service.createPlan({
          plan_date: "2026-10-05",
          category_distribution: [{ category_id: "cat_a", count: 1 }],
          scheduled_times: ["09:00"],
        })
        const productSource = async () => []
        await expect(
          service.createBatchPlans(
            {
              start_date: "2026-10-04",
              days: 3,
              category_distribution: [{ category_id: "cat_a", count: 1 }],
              scheduled_times: ["09:00"],
            },
            { productSource },
          ),
        ).rejects.toThrow(/2026-10-05/)
      })
    })
  },
})
