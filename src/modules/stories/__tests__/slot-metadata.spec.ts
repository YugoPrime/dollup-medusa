if (process.env.DB_PORT !== "55432") {
  throw new Error(
    "Refusing to run: set DB_PORT=55432. Port 5432 on this laptop is the production database tunnel.",
  )
}

import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { STORIES_MODULE } from "../index"
import StoriesModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<StoriesModuleService>({
  moduleName: STORIES_MODULE,
  resolve: "./src/modules/stories",
  testSuite: ({ service }) => {
    describe("StoriesModuleService - atomic slot metadata", () => {
      let n = 0
      async function makeSlot(metadata: Record<string, unknown> | null, posted = false) {
        n += 1
        const date = `2026-07-${String(n).padStart(2, "0")}`
        const plan = await service.createPlan({
          plan_date: date,
          category_distribution: [{ category_id: "c1", count: 1 }],
          scheduled_times: ["09:00"],
        })
        return service.createStorySlots({
          plan_id: plan.id,
          slot_index: 0,
          scheduled_at: new Date(`${date}T09:00:00+04:00`),
          category_id: "c1",
          product_id: "prod_test",
          fallback_used: false,
          pick_attempt: 1,
          metadata,
          posted_at: posted ? new Date() : null,
        } as unknown as Parameters<typeof service.createStorySlots>[0])
      }
      async function meta(id: string) {
        const [s] = await service.listStorySlots({ id })
        return s.metadata as Record<string, any>
      }

      it("updateSlotMetadata keeps keys it does not name", async () => {
        const slot = await makeSlot({ publish: { id: "p" } })
        await service.updateSlotMetadata(slot.id, { render: { mp4_url: "u" } })
        expect(await meta(slot.id)).toEqual({ publish: { id: "p" }, render: { mp4_url: "u" } })
      })

      it("works on a slot whose metadata is null", async () => {
        const slot = await makeSlot(null)
        await service.updateSlotMetadata(slot.id, { a: 1 })
        expect(await meta(slot.id)).toEqual({ a: 1 })
      })

      it("two writers at once both keep their keys", async () => {
        const slot = await makeSlot({})
        await Promise.all([
          service.updateSlotMetadata(slot.id, { render: { mp4_url: "u" } }),
          service.updateSlotMetadata(slot.id, { publish: { id: "p" } }),
        ])
        const m = await meta(slot.id)
        expect(m.render).toEqual({ mp4_url: "u" })
        expect(m.publish).toEqual({ id: "p" })
      })

      it("null still clears a value", async () => {
        const slot = await makeSlot({})
        await service.updateSlotMetadata(slot.id, { render_error: { m: 1 } })
        await service.updateSlotMetadata(slot.id, { render_error: null })
        const m = await meta(slot.id)
        expect(m).toHaveProperty("render_error")
        expect(m.render_error).toBeNull()
      })

      it("an unknown slot throws", async () => {
        await expect(service.updateSlotMetadata("stslot_nope", { a: 1 })).rejects.toThrow(
          "Slot stslot_nope not found",
        )
      })

      it("IfJob writes only for the current job", async () => {
        const slot = await makeSlot({ render_job: { job_id: "J1" } })
        expect(await service.updateSlotMetadataIfJob(slot.id, "J2", { render: { x: 1 } })).toBe(false)
        expect(await meta(slot.id)).toEqual({ render_job: { job_id: "J1" } })
        expect(await service.updateSlotMetadataIfJob(slot.id, "J1", { render: { x: 1 } })).toBe(true)
        expect(await meta(slot.id)).toEqual({ render_job: { job_id: "J1" }, render: { x: 1 } })
      })

      it("IfJob refuses a posted slot", async () => {
        const slot = await makeSlot({ render_job: { job_id: "J1" } }, true)
        expect(await service.updateSlotMetadataIfJob(slot.id, "J1", { render: { x: 1 } })).toBe(false)
      })
    })
  },
})
