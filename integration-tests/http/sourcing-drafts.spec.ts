import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
jest.setTimeout(60 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api }) => {
    let token = ""
    let supplierId = ""

    beforeAll(async () => {
      const reg = await api.post("/auth/user/emailpass/register", {
        email: "drafts-admin@dollup.test",
        password: "supersecret",
      })
      token = reg.data.token
      const s = await api.post(
        "/admin/sourcing/suppliers",
        { name: "S" },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      supplierId = s.data.supplier.id
    })

    const auth = () => ({ headers: { Authorization: `Bearer ${token}` } })

    describe("Sourcing drafts API", () => {
      it("creates a draft and lists it under the supplier", async () => {
        const created = await api.post(
          "/admin/sourcing/drafts",
          { supplier_id: supplierId },
          auth(),
        )
        expect(created.data.draft.status).toBe("drafting")
        const list = await api.get(
          `/admin/sourcing/suppliers/${supplierId}/drafts`,
          auth(),
        )
        expect(list.data.drafts.map((d: { id: string }) => d.id)).toContain(
          created.data.draft.id,
        )
      })

      it("returns full draft incl. items + variants on GET", async () => {
        const created = await api.post(
          "/admin/sourcing/drafts",
          { supplier_id: supplierId },
          auth(),
        )
        const got = await api.get(
          `/admin/sourcing/drafts/${created.data.draft.id}`,
          auth(),
        )
        expect(got.data.draft.id).toBe(created.data.draft.id)
        expect(Array.isArray(got.data.draft.items)).toBe(true)
      })

      it("PATCHes notes and landed_cost_multiplier", async () => {
        const created = await api.post(
          "/admin/sourcing/drafts",
          { supplier_id: supplierId },
          auth(),
        )
        const patched = await api.patch(
          `/admin/sourcing/drafts/${created.data.draft.id}`,
          { notes: "Q4 buy", landed_cost_multiplier: 1.7 },
          auth(),
        )
        expect(patched.data.draft.notes).toBe("Q4 buy")
        expect(Number(patched.data.draft.landed_cost_multiplier)).toBeCloseTo(1.7, 3)
      })

      it("rejects skipping states on transition", async () => {
        const created = await api.post(
          "/admin/sourcing/drafts",
          { supplier_id: supplierId },
          auth(),
        )
        const res = await api
          .post(
            `/admin/sourcing/drafts/${created.data.draft.id}/transition`,
            { to: "paid" },
            auth(),
          )
          .catch((e) => e.response)
        expect(res.status).toBe(400)
      })

      it("400 on backward transition without reason", async () => {
        const c = await api.post(
          "/admin/sourcing/drafts",
          { supplier_id: supplierId },
          auth(),
        )
        const item = await api.post(
          `/admin/sourcing/drafts/${c.data.draft.id}/items`,
          { working_name: "x", cost_usd: 5 },
          auth(),
        )
        await api.put(
          `/admin/sourcing/items/${item.data.item.id}/variants`,
          { variants: [{ color: null, size: "S", qty: 3 }] },
          auth(),
        )
        await api.post(
          `/admin/sourcing/drafts/${c.data.draft.id}/transition`,
          { to: "negotiating" },
          auth(),
        )
        await api.post(
          `/admin/sourcing/drafts/${c.data.draft.id}/transition`,
          { to: "paid" },
          auth(),
        )
        const res = await api
          .post(
            `/admin/sourcing/drafts/${c.data.draft.id}/transition`,
            { to: "negotiating" },
            auth(),
          )
          .catch((e) => e.response)
        expect(res.status).toBe(400)
      })
    })
  },
})
