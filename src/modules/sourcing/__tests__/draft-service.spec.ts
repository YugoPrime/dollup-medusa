import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { SOURCING_MODULE } from "../index"
import SourcingModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<SourcingModuleService>({
  moduleName: SOURCING_MODULE,
  resolve: "./src/modules/sourcing",
  testSuite: ({ service }) => {
    describe("SourcingModuleService — drafts", () => {
      let supplierId: string
      beforeEach(async () => {
        const s = await service.createSupplier({ name: "Test Supplier" })
        supplierId = s.id
      })

      it("creates a draft in 'drafting' with USD and 1.5 multiplier defaults", async () => {
        const d = await service.createDraft({ supplier_id: supplierId })
        expect(d.id).toMatch(/^dord_/)
        expect(d.status).toBe("drafting")
        expect(d.currency).toBe("USD")
        expect(Number(d.landed_cost_multiplier)).toBeCloseTo(1.5, 3)
      })

      it("transitions drafting → negotiating → paid with paid_at set", async () => {
        const d = await service.createDraft({ supplier_id: supplierId })
        await service.transitionDraft(d.id, "negotiating")
        const item = await service.createItem({
          draft_order_id: d.id,
          working_name: "Test",
          cost_usd: 5,
        })
        await service.replaceVariants(item.id, [{ size: "S", qty: 3, color: null }])
        await service.transitionDraft(d.id, "paid")
        const after = await service.retrieveDraft(d.id)
        expect(after.status).toBe("paid")
        expect(after.paid_at).not.toBeNull()
      })

      it("blocks → paid when any item has zero qty", async () => {
        const d = await service.createDraft({ supplier_id: supplierId })
        await service.createItem({
          draft_order_id: d.id,
          working_name: "Empty",
          cost_usd: 5,
        })
        await service.transitionDraft(d.id, "negotiating")
        await expect(service.transitionDraft(d.id, "paid")).rejects.toThrow(
          /0 total qty/i,
        )
      })

      it("blocks → paid when any item has zero cost", async () => {
        const d = await service.createDraft({ supplier_id: supplierId })
        const item = await service.createItem({
          draft_order_id: d.id,
          working_name: "No cost",
          cost_usd: 0,
        })
        await service.replaceVariants(item.id, [{ size: "S", qty: 3, color: null }])
        await service.transitionDraft(d.id, "negotiating")
        await expect(service.transitionDraft(d.id, "paid")).rejects.toThrow(
          /no cost/i,
        )
      })

      it("blocks shipped → received? no — paid → shipped → received works", async () => {
        const d = await service.createDraft({ supplier_id: supplierId })
        const item = await service.createItem({
          draft_order_id: d.id,
          working_name: "OK",
          cost_usd: 5,
        })
        await service.replaceVariants(item.id, [{ size: "S", qty: 3, color: null }])
        await service.transitionDraft(d.id, "negotiating")
        await service.transitionDraft(d.id, "paid")
        await service.transitionDraft(d.id, "shipped")
        const shipped = await service.retrieveDraft(d.id)
        expect(shipped.shipped_at).not.toBeNull()
        await service.transitionDraft(d.id, "received")
        const received = await service.retrieveDraft(d.id)
        expect(received.received_at).not.toBeNull()
      })

      it("rejects skipping states (drafting → paid)", async () => {
        const d = await service.createDraft({ supplier_id: supplierId })
        await expect(service.transitionDraft(d.id, "paid")).rejects.toThrow(
          /not allowed/i,
        )
      })

      it("allows backward transition with reason", async () => {
        const d = await service.createDraft({ supplier_id: supplierId })
        const item = await service.createItem({
          draft_order_id: d.id,
          working_name: "OK",
          cost_usd: 5,
        })
        await service.replaceVariants(item.id, [{ size: "S", qty: 3, color: null }])
        await service.transitionDraft(d.id, "negotiating")
        await service.transitionDraft(d.id, "paid")
        await service.transitionDraft(d.id, "negotiating", { reason: "supplier reset terms" })
        const back = await service.retrieveDraft(d.id)
        expect(back.status).toBe("negotiating")
      })

      it("rejects backward transition without reason", async () => {
        const d = await service.createDraft({ supplier_id: supplierId })
        const item = await service.createItem({
          draft_order_id: d.id,
          working_name: "OK",
          cost_usd: 5,
        })
        await service.replaceVariants(item.id, [{ size: "S", qty: 3, color: null }])
        await service.transitionDraft(d.id, "negotiating")
        await service.transitionDraft(d.id, "paid")
        await expect(
          service.transitionDraft(d.id, "negotiating"),
        ).rejects.toThrow(/reason/i)
      })

      it("only allows deleting drafting drafts", async () => {
        const d = await service.createDraft({ supplier_id: supplierId })
        await service.deleteDraftStrict(d.id)
        await expect(service.retrieveDraft(d.id)).rejects.toThrow()

        const d2 = await service.createDraft({ supplier_id: supplierId })
        await service.transitionDraft(d2.id, "negotiating")
        await expect(service.deleteDraftStrict(d2.id)).rejects.toThrow(/drafting/)
      })

      it("summarizes supplier draft cards without per-draft retrieval", async () => {
        const draft = await service.createDraft({ supplier_id: supplierId })
        const itemA = await service.createItem({
          draft_order_id: draft.id,
          working_name: "Dress",
          cost_usd: 5,
        })
        await service.replaceVariants(itemA.id, [
          { size: "S", qty: 2, color: "Pink" },
          { size: "M", qty: 3, color: "Pink" },
        ])
        const itemB = await service.createItem({
          draft_order_id: draft.id,
          working_name: "Skirt",
          cost_usd: 7.5,
        })
        await service.replaceVariants(itemB.id, [
          { size: "One Size", qty: 4, color: null },
        ])

        const [withSummary] = await service.listDraftsForSupplierWithSummary(
          supplierId,
        )

        expect(withSummary.summary).toEqual({
          item_count: 2,
          total_pcs: 9,
          total_usd: 55,
        })
      })

      it("counts active and paid supplier drafts in one call", async () => {
        const active = await service.createDraft({ supplier_id: supplierId })
        await service.transitionDraft(active.id, "negotiating")

        const paid = await service.createDraft({ supplier_id: supplierId })
        const item = await service.createItem({
          draft_order_id: paid.id,
          working_name: "Ready",
          cost_usd: 5,
        })
        await service.replaceVariants(item.id, [
          { size: "S", qty: 1, color: null },
        ])
        await service.transitionDraft(paid.id, "negotiating")
        await service.transitionDraft(paid.id, "paid")

        const counts = await service.countDraftsForSuppliers([supplierId])

        expect(counts[supplierId]).toEqual({ active: 1, paid: 1 })
      })
    })
  },
})
