import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { SOURCING_MODULE } from "../index"
import type SourcingModuleService from "../service"

jest.setTimeout(60_000)

medusaIntegrationTestRunner({
  testSuite: ({ getContainer }) => {
    describe("SourcingModuleService.validateForPush", () => {
      let service: SourcingModuleService

      const setup = async () => {
        const supplier = await service.createSupplier({ name: "S" })
        const draft = await service.createDraft({ supplier_id: supplier.id })
        return { supplierId: supplier.id, draftId: draft.id }
      }

      const transitionToReceived = async (draftId: string) => {
        await service.transitionDraft(draftId, "negotiating")
        await service.transitionDraft(draftId, "paid")
        await service.transitionDraft(draftId, "shipped")
        await service.transitionDraft(draftId, "received")
      }

      beforeEach(() => {
        service = getContainer().resolve(SOURCING_MODULE)
      })

      it("flags missing price + missing image + zero received_qty", async () => {
        const { draftId } = await setup()
        const item = await service.createItem({
          draft_order_id: draftId,
          working_name: "Item",
          cost_usd: 10,
        })
        await service.replaceVariants(item.id, [
          { color: null, size: "M", qty: 5 },
        ])
        // Transition to received (this auto-defaults received_qty=qty=5)
        await transitionToReceived(draftId)
        // Override the auto-default to recreate the "no_received_qty" condition
        const variants = await service.listVariants(item.id)
        await service.setReceivedQty(variants[0].id, 0)
        // selling_price_mur is null; no image
        const result = await service.validateForPush(draftId)
        const itemReport = result.items.find((i) => i.id === item.id)
        expect(itemReport?.reasons).toEqual(
          expect.arrayContaining([
            "missing_selling_price",
            "missing_image",
            "no_received_qty",
          ]),
        )
        expect(result.ok).toBe(false)
      })

      it("passes when item has price + image + received_qty", async () => {
        const { draftId } = await setup()
        const item = await service.createItem({
          draft_order_id: draftId,
          working_name: "Item",
          cost_usd: 10,
          scraped_image_url: "https://example.com/x.jpg",
        })
        await service.replaceVariants(item.id, [
          { color: null, size: "M", qty: 5 },
        ])
        await service.setItemPrice(item.id, 1500)
        await transitionToReceived(draftId)
        const variants = await service.listVariants(item.id)
        // explicit set (no-op since auto-default = 5; documents intent)
        await service.setReceivedQty(variants[0].id, 5)
        const result = await service.validateForPush(draftId)
        expect(result.ok).toBe(true)
        expect(result.items.find((i) => i.id === item.id)?.reasons).toEqual([])
      })

      it("flags invalid variant override price", async () => {
        const { draftId } = await setup()
        const item = await service.createItem({
          draft_order_id: draftId,
          working_name: "Item",
          cost_usd: 10,
          scraped_image_url: "https://example.com/x.jpg",
        })
        await service.replaceVariants(item.id, [
          { color: null, size: "M", qty: 5 },
        ])
        await service.setItemPrice(item.id, 1500)
        await transitionToReceived(draftId)
        const variants = await service.listVariants(item.id)
        await service.setReceivedQty(variants[0].id, 5)
        // Force-set an invalid override (bypass setter validation by direct DB)
        // We use the public setter — should reject
        await expect(
          service.setVariantOverridePrice(variants[0].id, 0),
        ).rejects.toThrow()
      })

      it("excludes already-published items from validation", async () => {
        const { draftId } = await setup()
        const item = await service.createItem({
          draft_order_id: draftId,
          working_name: "Item",
          cost_usd: 10,
        })
        // Need at least one variant with qty for the draft to be transitionable
        await service.replaceVariants(item.id, [
          { color: null, size: "M", qty: 1 },
        ])
        await transitionToReceived(draftId)
        // Mark as published — should be excluded from validation
        await service.markItemPublished(item.id, "prod_test")
        const result = await service.validateForPush(draftId)
        expect(result.items.find((i) => i.id === item.id)?.reasons).toEqual([])
        expect(result.ok).toBe(true)
      })
    })
  },
})
