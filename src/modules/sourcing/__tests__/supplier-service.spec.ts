import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { SOURCING_MODULE } from "../index"
import SourcingModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<SourcingModuleService>({
  moduleName: SOURCING_MODULE,
  resolve: "./src/modules/sourcing",
  testSuite: ({ service }) => {
    describe("SourcingModuleService — suppliers", () => {
      it("creates a supplier with required fields and trims name", async () => {
        const s = await service.createSupplier({
          name: "  Alibaba ABC  ",
          contact_handle: "abc_factory",
        })
        expect(s.id).toMatch(/^supp_/)
        expect(s.name).toBe("Alibaba ABC")
        expect(s.contact_handle).toBe("abc_factory")
        expect(s.archived_at).toBeNull()
      })

      it("rejects empty name", async () => {
        await expect(
          service.createSupplier({ name: "   " }),
        ).rejects.toThrow(/name/i)
      })

      it("lists active suppliers, hiding archived by default", async () => {
        const a = await service.createSupplier({ name: "Active Co" })
        const z = await service.createSupplier({ name: "Archived Co" })
        await service.archiveSupplier(z.id)

        const active = await service.listActiveSuppliers()
        const ids = active.map((s) => s.id)
        expect(ids).toContain(a.id)
        expect(ids).not.toContain(z.id)
      })

      it("archives + unarchives by setting archived_at", async () => {
        const s = await service.createSupplier({ name: "Toggle Co" })
        await service.archiveSupplier(s.id)
        const archived = await service.retrieveSupplier(s.id)
        expect(archived.archived_at).not.toBeNull()
        await service.unarchiveSupplier(s.id)
        const restored = await service.retrieveSupplier(s.id)
        expect(restored.archived_at).toBeNull()
      })

      it("blocks deletion when supplier has any draft past drafting", async () => {
        const s = await service.createSupplier({ name: "Cant Delete" })
        const draft = await service.createDraft({ supplier_id: s.id })
        await service.transitionDraft(draft.id, "negotiating")
        await service.transitionDraft(draft.id, "paid")
        await expect(service.deleteSupplierStrict(s.id)).rejects.toThrow(
          /past drafting/i,
        )
      })

      it("allows deletion when only drafting drafts exist (cascades)", async () => {
        const s = await service.createSupplier({ name: "Can Delete" })
        await service.createDraft({ supplier_id: s.id })
        await service.deleteSupplierStrict(s.id)
        await expect(service.retrieveSupplier(s.id)).rejects.toThrow()
      })
    })
  },
})
