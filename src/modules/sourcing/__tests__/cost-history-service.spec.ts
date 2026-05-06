import { moduleIntegrationTestRunner } from "@medusajs/test-utils"
import { SOURCING_MODULE } from "../index"
import SourcingModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<SourcingModuleService>({
  moduleName: SOURCING_MODULE,
  resolve: "./src/modules/sourcing",
  testSuite: ({ service }) => {
    describe("SourcingModuleService — cost history", () => {
      async function bring(toStatus: "negotiating" | "paid" | "shipped" | "received") {
        const s = await service.createSupplier({ name: "Hist" })
        const d = await service.createDraft({ supplier_id: s.id })
        const item = await service.createItem({ draft_order_id: d.id, cost_usd: 5 })
        await service.replaceVariants(item.id, [{ color: null, size: "S", qty: 3 }])
        if (toStatus === "negotiating") {
          await service.transitionDraft(d.id, "negotiating")
        } else {
          await service.transitionDraft(d.id, "negotiating")
          await service.transitionDraft(d.id, "paid")
          if (toStatus === "shipped" || toStatus === "received") {
            await service.transitionDraft(d.id, "shipped")
          }
          if (toStatus === "received") {
            await service.transitionDraft(d.id, "received")
          }
        }
        return { draftId: d.id, itemId: item.id }
      }

      it("does NOT write history when status is 'negotiating'", async () => {
        const { itemId } = await bring("negotiating")
        await service.updateItem(itemId, { cost_usd: 7 })
        const h = await service.listCostHistory(itemId)
        expect(h).toHaveLength(0)
      })

      it("requires reason on cost edit when status is 'paid'", async () => {
        const { itemId } = await bring("paid")
        await expect(
          service.updateItem(itemId, { cost_usd: 7 }),
        ).rejects.toThrow(/reason/i)
      })

      it("writes history row with reason on 'paid' cost edit", async () => {
        const { itemId } = await bring("paid")
        await service.updateItem(
          itemId,
          { cost_usd: 7 },
          { reason: "supplier rebate" },
        )
        const h = await service.listCostHistory(itemId)
        expect(h).toHaveLength(1)
        expect(Number(h[0].old_cost_usd)).toBeCloseTo(5, 2)
        expect(Number(h[0].new_cost_usd)).toBeCloseTo(7, 2)
        expect(h[0].reason).toBe("supplier rebate")
      })

      it("does not write history when cost is unchanged", async () => {
        const { itemId } = await bring("paid")
        await service.updateItem(itemId, { working_name: "Renamed" })
        const h = await service.listCostHistory(itemId)
        expect(h).toHaveLength(0)
      })

      it("works for 'shipped' and 'received' too", async () => {
        const a = await bring("shipped")
        await service.updateItem(a.itemId, { cost_usd: 8 }, { reason: "fee" })
        const b = await bring("received")
        await service.updateItem(b.itemId, { cost_usd: 6 }, { reason: "credit" })
        expect((await service.listCostHistory(a.itemId)).length).toBe(1)
        expect((await service.listCostHistory(b.itemId)).length).toBe(1)
      })
    })
  },
})
