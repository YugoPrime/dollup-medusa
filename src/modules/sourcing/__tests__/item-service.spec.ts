import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { SOURCING_MODULE } from "../index"
import SourcingModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<SourcingModuleService>({
  moduleName: SOURCING_MODULE,
  resolve: "./src/modules/sourcing",
  testSuite: ({ service }) => {
    describe("SourcingModuleService — items", () => {
      let draftId: string
      beforeEach(async () => {
        const s = await service.createSupplier({ name: "T" })
        const d = await service.createDraft({ supplier_id: s.id })
        draftId = d.id
      })

      it("creates an item with defaults", async () => {
        const item = await service.createItem({
          draft_order_id: draftId,
          working_name: "Black Lace Set",
          cost_usd: 6.7,
          source_type: "alibaba",
          source_url: "https://www.alibaba.com/product/x",
        })
        expect(item.id).toMatch(/^ditm_/)
        expect(item.working_name).toBe("Black Lace Set")
        expect(Number(item.cost_usd)).toBeCloseTo(6.7, 2)
        expect(item.source_type).toBe("alibaba")
        expect(item.position).toBe(0)
      })

      it("auto-assigns increasing position within a draft", async () => {
        const a = await service.createItem({ draft_order_id: draftId, cost_usd: 1 })
        const b = await service.createItem({ draft_order_id: draftId, cost_usd: 1 })
        const c = await service.createItem({ draft_order_id: draftId, cost_usd: 1 })
        expect(a.position).toBe(0)
        expect(b.position).toBe(1)
        expect(c.position).toBe(2)
      })

      it("updateItem in 'drafting' does NOT write cost history", async () => {
        const item = await service.createItem({ draft_order_id: draftId, cost_usd: 5 })
        await service.updateItem(item.id, { cost_usd: 7 })
        const history = await service.listCostHistory(item.id)
        expect(history).toHaveLength(0)
      })

      it("reorders an item to a new position and shifts others", async () => {
        const a = await service.createItem({ draft_order_id: draftId, cost_usd: 1 })
        const b = await service.createItem({ draft_order_id: draftId, cost_usd: 1 })
        const c = await service.createItem({ draft_order_id: draftId, cost_usd: 1 })
        await service.reorderItem(c.id, 0)
        const items = await service.listItems(draftId)
        const ordered = items.sort((x, y) => x.position - y.position).map((i) => i.id)
        expect(ordered).toEqual([c.id, a.id, b.id])
      })

      it("deletes an item and its variants/history", async () => {
        const item = await service.createItem({ draft_order_id: draftId, cost_usd: 1 })
        await service.replaceVariants(item.id, [{ color: null, size: "S", qty: 2 }])
        await service.deleteItem(item.id)
        const variants = await service.listVariants(item.id)
        expect(variants).toHaveLength(0)
      })
    })
  },
})
