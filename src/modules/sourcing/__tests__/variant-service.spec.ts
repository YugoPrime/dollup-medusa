import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { SOURCING_MODULE } from "../index"
import SourcingModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<SourcingModuleService>({
  moduleName: SOURCING_MODULE,
  resolve: "./src/modules/sourcing",
  testSuite: ({ service }) => {
    describe("SourcingModuleService — variants", () => {
      let itemId: string
      beforeEach(async () => {
        const s = await service.createSupplier({ name: "T" })
        const d = await service.createDraft({ supplier_id: s.id })
        const i = await service.createItem({ draft_order_id: d.id, cost_usd: 5 })
        itemId = i.id
      })

      it("replaces full matrix in one call (insert)", async () => {
        await service.replaceVariants(itemId, [
          { color: "Black", size: "S", qty: 3 },
          { color: "Black", size: "M", qty: 4 },
          { color: "Red", size: "S", qty: 3 },
        ])
        const v = await service.listVariants(itemId)
        expect(v).toHaveLength(3)
        const total = v.reduce((acc, x) => acc + x.qty, 0)
        expect(total).toBe(10)
      })

      it("replaces — replacing wipes old rows and inserts new shape", async () => {
        await service.replaceVariants(itemId, [
          { color: null, size: "S", qty: 3 },
          { color: null, size: "M", qty: 3 },
        ])
        await service.replaceVariants(itemId, [
          { color: null, size: "Free Size", qty: 6 },
        ])
        const v = await service.listVariants(itemId)
        expect(v).toHaveLength(1)
        expect(v[0].size).toBe("Free Size")
        expect(v[0].qty).toBe(6)
      })

      it("rejects negative qty", async () => {
        await expect(
          service.replaceVariants(itemId, [
            { color: null, size: "S", qty: -1 },
          ]),
        ).rejects.toThrow(/qty/i)
      })

      it("rejects duplicate (color, size) in the same payload", async () => {
        await expect(
          service.replaceVariants(itemId, [
            { color: "Black", size: "S", qty: 1 },
            { color: "Black", size: "S", qty: 2 },
          ]),
        ).rejects.toThrow(/duplicate/i)
      })

      it("rejects empty size", async () => {
        await expect(
          service.replaceVariants(itemId, [{ color: null, size: "", qty: 3 }]),
        ).rejects.toThrow(/size/i)
      })

      it("zero-qty rows are dropped, not persisted", async () => {
        await service.replaceVariants(itemId, [
          { color: null, size: "S", qty: 3 },
          { color: null, size: "M", qty: 0 },
        ])
        const v = await service.listVariants(itemId)
        expect(v).toHaveLength(1)
        expect(v[0].size).toBe("S")
      })
    })
  },
})
