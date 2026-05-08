import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
jest.setTimeout(60 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api }) => {
    let token = ""
    let draftId = ""

    beforeAll(async () => {
      const reg = await api.post("/auth/user/emailpass/register", {
        email: "items-admin@dollup.test",
        password: "supersecret",
      })
      token = reg.data.token
      const s = await api.post(
        "/admin/sourcing/suppliers",
        { name: "S" },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const d = await api.post(
        "/admin/sourcing/drafts",
        { supplier_id: s.data.supplier.id },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      draftId = d.data.draft.id
    })

    const auth = () => ({ headers: { Authorization: `Bearer ${token}` } })

    describe("Sourcing items + variants API", () => {
      it("creates an item, GETs it, replaces variants, reorders, then deletes", async () => {
        const item = await api.post(
          `/admin/sourcing/drafts/${draftId}/items`,
          { working_name: "Lace Set", cost_usd: 6.5, source_type: "alibaba" },
          auth(),
        )
        const itemId = item.data.item.id

        const got = await api.get(`/admin/sourcing/items/${itemId}`, auth())
        expect(got.data.item.working_name).toBe("Lace Set")

        const replaced = await api.put(
          `/admin/sourcing/items/${itemId}/variants`,
          {
            variants: [
              { color: "Black", size: "S", qty: 3 },
              { color: "Black", size: "M", qty: 4 },
            ],
          },
          auth(),
        )
        expect(replaced.data.variants).toHaveLength(2)

        const item2 = await api.post(
          `/admin/sourcing/drafts/${draftId}/items`,
          { working_name: "Robe", cost_usd: 4 },
          auth(),
        )
        await api.post(
          `/admin/sourcing/items/${item2.data.item.id}/reorder`,
          { position: 0 },
          auth(),
        )
        const draft = await api.get(`/admin/sourcing/drafts/${draftId}`, auth())
        const sorted = (
          draft.data.draft.items as Array<{ id: string; position: number }>
        )
          .sort((a, b) => a.position - b.position)
          .map((i) => i.id)
        expect(sorted[0]).toBe(item2.data.item.id)

        const del = await api.delete(`/admin/sourcing/items/${itemId}`, auth())
        expect(del.data.ok).toBe(true)
      })

      it("rejects bad variant payload (negative qty) with 400", async () => {
        const item = await api.post(
          `/admin/sourcing/drafts/${draftId}/items`,
          { cost_usd: 1 },
          auth(),
        )
        const res = await api
          .put(
            `/admin/sourcing/items/${item.data.item.id}/variants`,
            { variants: [{ color: null, size: "S", qty: -1 }] },
            auth(),
          )
          .catch((e) => e.response)
        expect(res.status).toBe(400)
      })
    })
  },
})
