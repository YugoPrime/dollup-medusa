import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { SOURCING_MODULE } from "../index"
import type SourcingModuleService from "../service"

jest.setTimeout(120_000)

medusaIntegrationTestRunner({
  testSuite: ({ getContainer, api }) => {
    describe("pushDraftToMedusa", () => {
      let service: SourcingModuleService
      let container: ReturnType<typeof getContainer>

      const fullySetUpDraft = async () => {
        const supplier = await service.createSupplier({ name: "S" })
        const draft = await service.createDraft({ supplier_id: supplier.id })
        const itemA = await service.createItem({
          draft_order_id: draft.id,
          working_name: "Cute Top",
          cost_usd: 8,
          scraped_image_url: "https://example.com/a.jpg",
        })
        await service.replaceVariants(itemA.id, [
          { color: "Red", size: "M", qty: 3 },
          { color: "Red", size: "L", qty: 2 },
        ])
        await service.setItemPrice(itemA.id, 1500)
        const itemB = await service.createItem({
          draft_order_id: draft.id,
          working_name: "Beach Cover",
          cost_usd: 12,
          scraped_image_url: "https://example.com/b.jpg",
        })
        await service.replaceVariants(itemB.id, [
          { color: null, size: "Free Size", qty: 5 },
        ])
        await service.setItemPrice(itemB.id, 2000)
        await service.transitionDraft(draft.id, "negotiating")
        await service.transitionDraft(draft.id, "paid")
        await service.transitionDraft(draft.id, "shipped")
        await service.transitionDraft(draft.id, "received")
        return { draftId: draft.id, itemAId: itemA.id, itemBId: itemB.id }
      }

      beforeEach(() => {
        container = getContainer()
        service = container.resolve(SOURCING_MODULE)
      })

      it("creates Medusa products with assigned Refs and inventory", async () => {
        const { draftId, itemAId, itemBId } = await fullySetUpDraft()
        const result = await service.pushDraftToMedusa(draftId)
        expect(result.failed).toEqual([])
        expect(result.pushed).toHaveLength(2)
        const a = result.pushed.find((p) => p.draft_item_id === itemAId)
        const b = result.pushed.find((p) => p.draft_item_id === itemBId)
        expect(a?.ref).toMatch(/^IS\d+$/)
        expect(b?.ref).toMatch(/^IS\d+$/)
        expect(a?.ref).not.toBe(b?.ref)
        const aItem = await service.retrieveItem(itemAId)
        expect(aItem.published_product_id).toBe(a?.product_id)

        // Asserts inventory items got created + linked for every variant —
        // catches the C2 silent-failure regression where query.graph field
        // path drift returns empty levelInputs.
        const aProductId = a?.product_id
        const aProductRes = await api.get(
          `/admin/products/${aProductId}?fields=variants.inventory_items.id,variants.sku`,
        )
        const variants = aProductRes.data.product.variants as Array<{
          sku: string
          inventory_items?: unknown[]
        }>
        for (const v of variants) {
          expect(v.inventory_items).toBeDefined()
          expect((v.inventory_items as unknown[]).length).toBeGreaterThan(0)
        }
      })

      it("locks pushed items from edits", async () => {
        const { draftId, itemAId } = await fullySetUpDraft()
        await service.pushDraftToMedusa(draftId)
        await expect(service.setItemPrice(itemAId, 9999)).rejects.toThrow(
          /locked|published/i,
        )
      })

      it("idempotent: re-pushing skips already-published items", async () => {
        const { draftId } = await fullySetUpDraft()
        const first = await service.pushDraftToMedusa(draftId)
        const second = await service.pushDraftToMedusa(draftId)
        expect(first.pushed).toHaveLength(2)
        expect(second.pushed).toHaveLength(0)
        expect(second.failed).toEqual([])
      })

      it("rejects when draft is not in 'received' status", async () => {
        const supplier = await service.createSupplier({ name: "S" })
        const draft = await service.createDraft({ supplier_id: supplier.id })
        await expect(service.pushDraftToMedusa(draft.id)).rejects.toThrow(
          /received/i,
        )
      })

      it("creates products with Color/Size when colors present, Size only when not", async () => {
        const { draftId, itemAId, itemBId } = await fullySetUpDraft()
        const result = await service.pushDraftToMedusa(draftId)
        const aProductId = result.pushed.find((p) => p.draft_item_id === itemAId)?.product_id
        const bProductId = result.pushed.find((p) => p.draft_item_id === itemBId)?.product_id
        expect(aProductId).toBeDefined()
        expect(bProductId).toBeDefined()
        const aRes = await api.get(`/admin/products/${aProductId}`)
        const bRes = await api.get(`/admin/products/${bProductId}`)
        const aOptionTitles = aRes.data.product.options.map((o: { title: string }) => o.title).sort()
        const bOptionTitles = bRes.data.product.options.map((o: { title: string }) => o.title).sort()
        expect(aOptionTitles).toEqual(["Color", "Size"])
        expect(bOptionTitles).toEqual(["Size"])
        expect(aRes.data.product.handle).toMatch(/^is\d+$/)
        expect(aRes.data.product.status).toBe("published")
      })
    })
  },
})
