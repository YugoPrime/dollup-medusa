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
  testSuite: ({ service, MikroOrmWrapper }) => {
    describe("StoriesModuleService - atomic slot metadata", () => {
      let n = 0
      async function makeSlot(
        metadata: Record<string, unknown> | null,
        posted = false,
        productId: string | null = "prod_test",
      ) {
        n += 1
        const date = `2026-07-${String(n).padStart(2, "0")}`
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
          product_id: productId,
          fallback_used: false,
          pick_attempt: 1,
          metadata,
          posted_at: posted ? new Date() : null,
        } as unknown as Parameters<typeof service.createStorySlots>[0])
        return slot as unknown as { id: string }
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
        // Writer A holds the row lock with an uncommitted write; writer B (the
        // service) must queue behind it and then merge, not overwrite, A's key.
        const em = MikroOrmWrapper.forkManager()
        await em.begin()
        await em.execute(
          `UPDATE story_slot SET metadata = metadata || '{"render":{"mp4_url":"u"}}'::jsonb WHERE id = ?`,
          [slot.id],
        )
        let pending: Promise<void> | undefined
        let waiting = false
        try {
          pending = service.updateSlotMetadata(slot.id, { publish: { id: "p" } })
          pending.catch(() => undefined)
          for (let i = 0; i < 50 && !waiting; i++) {
            const rows = await MikroOrmWrapper.forkManager().execute(
              `SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%story_slot%'`,
            )
            waiting = rows.length > 0
            if (!waiting) await new Promise((r) => setTimeout(r, 100))
          }
        } finally {
          // Always release the lock, or the test DB cleanup would hang on it.
          await em.commit()
        }
        expect(waiting).toBe(true)
        await pending
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

      it("IfJob state guards", async () => {
        const patch = { render: { x: 1 } }
        const done = await makeSlot({ render_job: { job_id: "J1", state: "done" } })
        expect(await service.updateSlotMetadataIfJob(done.id, "J1", patch, { is: "sent" })).toBe(false)
        expect(await meta(done.id)).toEqual({ render_job: { job_id: "J1", state: "done" } })
        expect(await service.updateSlotMetadataIfJob(done.id, "J1", patch, { isNot: "done" })).toBe(false)

        const failed = await makeSlot({ render_job: { job_id: "J1", state: "failed" } })
        expect(await service.updateSlotMetadataIfJob(failed.id, "J1", patch, { isNot: "done" })).toBe(true)

        const sent = await makeSlot({ render_job: { job_id: "J1", state: "sent" } })
        expect(await service.updateSlotMetadataIfJob(sent.id, "J1", patch, { is: "sent" })).toBe(true)
        expect((await meta(sent.id)).render).toEqual({ x: 1 })
      })

      it("IfJob refuses a posted slot", async () => {
        const slot = await makeSlot({ render_job: { job_id: "J1" } }, true)
        expect(await service.updateSlotMetadataIfJob(slot.id, "J1", { render: { x: 1 } })).toBe(false)
      })

      const NEW_PRODUCT = {
        id: "p_new",
        title: "New",
        handle: "new",
        variants: [
          {
            id: "v1",
            inventory_quantity: 2,
            prices: [{ amount: 129000, currency_code: "mur" }],
            options: { color: "Red", size: "M" },
            images: [{ url: "https://cdn/x.jpg" }],
          },
        ],
      }

      const RENDERED = {
        render: { mp4_url: "old" },
        render_error: { message: "x" },
        render_started_at: "2026-11-02T10:00:00Z",
        render_job: { job_id: "J1" },
        render_shadow: { mp4_url: "shadow" },
        publish_error: { message: "earlier" },
      }

      it("swapSlotProduct drops every render key and fails the old job's guard", async () => {
        const slot = await makeSlot(RENDERED)
        await service.swapSlotProduct(slot.id, NEW_PRODUCT)
        expect(await meta(slot.id)).toEqual({ publish_error: { message: "earlier" } })
        expect(await service.updateSlotMetadataIfJob(slot.id, "J1", { render: { x: 1 } })).toBe(false)
        const [row] = await service.listStorySlots({ id: slot.id })
        expect(row.product_id).toBe("p_new")
        expect(row.pick_attempt).toBe(2)
      })

      it("clearSlotProduct drops every render key and fails the old job's guard", async () => {
        const slot = await makeSlot(RENDERED)
        await service.clearSlotProduct(slot.id)
        expect(await meta(slot.id)).toEqual({ publish_error: { message: "earlier" } })
        expect(await service.updateSlotMetadataIfJob(slot.id, "J1", { render: { x: 1 } })).toBe(false)
        const [row] = await service.listStorySlots({ id: slot.id })
        expect(row.product_id).toBeNull()
      })

      // The drop and the product update are one transaction: if the update
      // fails, the render keys come back, so no prod stamp can land between them.
      async function failingProductUpdate(run: () => Promise<void>) {
        // `service` is a get-only proxy, so spy where the method lives.
        const spy = jest
          .spyOn(StoriesModuleService.prototype, "updateStorySlots")
          .mockRejectedValueOnce(new Error("boom"))
        try {
          await expect(run()).rejects.toThrow("boom")
          expect(spy).toHaveBeenCalledTimes(1)
        } finally {
          spy.mockRestore()
        }
      }

      it("swapSlotProduct keeps the render keys when the product update fails", async () => {
        const slot = await makeSlot(RENDERED)
        await failingProductUpdate(() => service.swapSlotProduct(slot.id, NEW_PRODUCT))
        expect(await meta(slot.id)).toEqual(RENDERED)
        expect(await asRead(slot.id)).toEqual({ product_id: "prod_test", pick_attempt: 1 })
      })

      it("clearSlotProduct keeps the render keys when the product update fails", async () => {
        const slot = await makeSlot(RENDERED)
        await failingProductUpdate(() => service.clearSlotProduct(slot.id))
        expect(await meta(slot.id)).toEqual(RENDERED)
        expect(await asRead(slot.id)).toEqual({ product_id: "prod_test", pick_attempt: 1 })
      })

      const STAMP = { render_job: { job_id: "J_old" } }
      async function asRead(id: string) {
        const [s] = await service.listStorySlots({ id })
        return { product_id: s.product_id, pick_attempt: s.pick_attempt }
      }

      it("IfUnchanged writes while product_id and pick_attempt match", async () => {
        const slot = await makeSlot({ publish: { id: "p" } })
        expect(await asRead(slot.id)).toEqual({ product_id: "prod_test", pick_attempt: 1 })
        expect(
          await service.updateSlotMetadataIfUnchanged(
            slot.id,
            { product_id: "prod_test", pick_attempt: 1 },
            STAMP,
          ),
        ).toBe(true)
        expect(await meta(slot.id)).toEqual({ publish: { id: "p" }, ...STAMP })
        expect(
          await service.updateSlotMetadataIfUnchanged(
            slot.id,
            { product_id: "prod_other", pick_attempt: 1 },
            { x: 1 },
          ),
        ).toBe(false)
        expect(
          await service.updateSlotMetadataIfUnchanged(
            slot.id,
            { product_id: "prod_test", pick_attempt: 2 },
            { x: 1 },
          ),
        ).toBe(false)
        expect(await meta(slot.id)).toEqual({ publish: { id: "p" }, ...STAMP })
      })

      it("IfUnchanged matches a null product_id", async () => {
        const slot = await makeSlot(null, false, null)
        expect(
          await service.updateSlotMetadataIfUnchanged(
            slot.id,
            { product_id: null, pick_attempt: 1 },
            STAMP,
          ),
        ).toBe(true)
        expect(await meta(slot.id)).toEqual(STAMP)
        expect(
          await service.updateSlotMetadataIfUnchanged(
            slot.id,
            { product_id: "prod_test", pick_attempt: 1 },
            { x: 1 },
          ),
        ).toBe(false)
        expect(await meta(slot.id)).toEqual(STAMP)
      })

      it("IfUnchanged refuses the slot as read after swapSlotProduct", async () => {
        const slot = await makeSlot(RENDERED)
        const before = await asRead(slot.id)
        await service.swapSlotProduct(slot.id, NEW_PRODUCT)
        expect(await asRead(slot.id)).toEqual({ product_id: "p_new", pick_attempt: 2 })
        expect(await service.updateSlotMetadataIfUnchanged(slot.id, before, STAMP)).toBe(false)
        expect(await meta(slot.id)).toEqual({ publish_error: { message: "earlier" } })
      })

      it("IfUnchanged refuses the slot as read after clearSlotProduct", async () => {
        const slot = await makeSlot(RENDERED)
        const before = await asRead(slot.id)
        await service.clearSlotProduct(slot.id)
        expect(await asRead(slot.id)).toEqual({ product_id: null, pick_attempt: 1 })
        expect(await service.updateSlotMetadataIfUnchanged(slot.id, before, STAMP)).toBe(false)
        expect(await meta(slot.id)).toEqual({ publish_error: { message: "earlier" } })
      })

      it("a prod stamp sent between the drop and the product update waits, then misses", async () => {
        const slot = await makeSlot(RENDERED)
        const before = await asRead(slot.id)
        const real = StoriesModuleService.prototype.updateStorySlots as (...a: unknown[]) => unknown
        let stamp: Promise<boolean> | undefined
        let waiting = false
        const spy = jest
          .spyOn(StoriesModuleService.prototype, "updateStorySlots")
          .mockImplementationOnce(async function (this: unknown, ...args: unknown[]) {
            // The render keys are dropped; the old product is still on the row.
            stamp = service.updateSlotMetadataIfUnchanged(slot.id, before, STAMP)
            let settled = false
            stamp.then(
              () => (settled = true),
              () => (settled = true),
            )
            for (let i = 0; i < 50 && !waiting && !settled; i++) {
              const rows = await MikroOrmWrapper.forkManager().execute(
                `SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE '%story_slot%'`,
              )
              waiting = rows.length > 0
              if (!waiting) await new Promise((r) => setTimeout(r, 100))
            }
            return real.apply(this, args)
          } as never)
        try {
          await service.swapSlotProduct(slot.id, NEW_PRODUCT)
        } finally {
          spy.mockRestore()
        }
        expect(waiting).toBe(true)
        expect(await stamp).toBe(false)
        expect(await meta(slot.id)).toEqual({ publish_error: { message: "earlier" } })
      })

      it("IfUnchanged refuses a deleted slot", async () => {
        const slot = await makeSlot({})
        const before = await asRead(slot.id)
        await service.softDeleteStorySlots([slot.id])
        expect(await service.updateSlotMetadataIfUnchanged(slot.id, before, STAMP)).toBe(false)
      })
    })
  },
})
