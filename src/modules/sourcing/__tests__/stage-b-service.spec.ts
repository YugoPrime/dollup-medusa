import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { SOURCING_MODULE } from "../index"
import type SourcingModuleService from "../service"

jest.setTimeout(60_000)

medusaIntegrationTestRunner({
  testSuite: ({ getContainer }) => {
    describe("SourcingModuleService — Stage B methods", () => {
      let service: SourcingModuleService

      const seed = async () => {
        const supplier = await service.createSupplier({ name: "S" })
        const draft = await service.createDraft({ supplier_id: supplier.id })
        const item = await service.createItem({
          draft_order_id: draft.id,
          working_name: "Item",
          cost_usd: 10,
        })
        await service.replaceVariants(item.id, [
          { color: "red", size: "M", qty: 5 },
          { color: "red", size: "L", qty: 3 },
        ])
        return { supplierId: supplier.id, draftId: draft.id, itemId: item.id }
      }

      beforeEach(() => {
        service = getContainer().resolve(SOURCING_MODULE)
      })

      describe("setItemPrice", () => {
        it("sets selling_price_mur on the item", async () => {
          const { itemId } = await seed()
          await service.setItemPrice(itemId, 1750)
          const item = await service.retrieveItem(itemId)
          expect(Number(item.selling_price_mur)).toBe(1750)
        })

        it("rejects non-positive price", async () => {
          const { itemId } = await seed()
          await expect(service.setItemPrice(itemId, 0)).rejects.toThrow()
          await expect(service.setItemPrice(itemId, -100)).rejects.toThrow()
        })

        it("blocks edit when item is published", async () => {
          const { itemId } = await seed()
          await service.markItemPublished(itemId, "prod_test")
          await expect(service.setItemPrice(itemId, 999)).rejects.toThrow(/locked|published/i)
        })
      })

      describe("setVariantOverridePrice", () => {
        it("sets override_price_mur on a variant", async () => {
          const { itemId } = await seed()
          const variants = await service.listVariants(itemId)
          const v = variants[0]
          await service.setVariantOverridePrice(v.id, 2000)
          const after = (await service.listVariants(itemId)).find((x) => x.id === v.id)
          expect(Number(after?.override_price_mur)).toBe(2000)
        })

        it("clears override when null is passed", async () => {
          const { itemId } = await seed()
          const variants = await service.listVariants(itemId)
          const v = variants[0]
          await service.setVariantOverridePrice(v.id, 2000)
          await service.setVariantOverridePrice(v.id, null)
          const after = (await service.listVariants(itemId)).find((x) => x.id === v.id)
          expect(after?.override_price_mur).toBeNull()
        })
      })

      describe("setReceivedQty", () => {
        it("sets received_qty per variant", async () => {
          const { itemId } = await seed()
          const variants = await service.listVariants(itemId)
          await service.setReceivedQty(variants[0].id, 4)
          const after = (await service.listVariants(itemId)).find((x) => x.id === variants[0].id)
          expect(after?.received_qty).toBe(4)
        })

        it("rejects negative", async () => {
          const { itemId } = await seed()
          const variants = await service.listVariants(itemId)
          await expect(service.setReceivedQty(variants[0].id, -1)).rejects.toThrow()
        })

        it("allows received > qty (over-shipment)", async () => {
          const { itemId } = await seed()
          const variants = await service.listVariants(itemId)
          // qty=5 → received_qty=10 should work
          await expect(service.setReceivedQty(variants[0].id, 10)).resolves.not.toThrow()
        })
      })
    })
  },
})
