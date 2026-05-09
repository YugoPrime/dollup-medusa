import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
jest.setTimeout(60 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let token = ""
    let itemId = ""
    let variantId = ""

    beforeAll(async () => {
      const reg = await api.post("/auth/user/emailpass/register", {
        email: "prices-admin@dollup.test",
        password: "supersecret",
      })
      token = reg.data.token

      const container = getContainer()
      const userModule = container.resolve("user")
      const existing = await userModule.listUsers({
        email: "prices-admin@dollup.test",
      })
      if (existing.length === 0) {
        await userModule.createUsers({ email: "prices-admin@dollup.test" })
      }

      const auth = { headers: { Authorization: `Bearer ${token}` } }

      const sup = await api.post(
        "/admin/sourcing/suppliers",
        { name: "Prices Supplier" },
        auth,
      )
      const supplierId = sup.data.supplier.id

      const draft = await api.post(
        "/admin/sourcing/drafts",
        { supplier_id: supplierId },
        auth,
      )
      const draftId = draft.data.draft.id

      const item = await api.post(
        `/admin/sourcing/drafts/${draftId}/items`,
        { working_name: "Price Test Item", cost_usd: 8 },
        auth,
      )
      itemId = item.data.item.id

      const vars = await api.put(
        `/admin/sourcing/items/${itemId}/variants`,
        { variants: [{ color: "red", size: "S", qty: 5 }] },
        auth,
      )
      variantId = vars.data.variants[0].id
    })

    function authed(headers: Record<string, string> = {}) {
      return { headers: { Authorization: `Bearer ${token}`, ...headers } }
    }

    describe("Sourcing prices + received API", () => {
      it("PATCH item price persists", async () => {
        const res = await api.patch(
          `/admin/sourcing/items/${itemId}/price`,
          { selling_price_mur: 1500 },
          authed(),
        )
        expect(res.status).toBe(200)
        expect(res.data.item.selling_price_mur).toBe(1500)
      })

      it("PATCH variant override price persists", async () => {
        const res = await api.patch(
          `/admin/sourcing/items/${itemId}/variants/${variantId}/price`,
          { override_price_mur: 1750 },
          authed(),
        )
        expect(res.status).toBe(200)
        expect(res.data.ok).toBe(true)
      })

      it("PATCH variant received_qty persists", async () => {
        const res = await api.patch(
          `/admin/sourcing/items/${itemId}/variants/${variantId}/received`,
          { received_qty: 4 },
          authed(),
        )
        expect(res.status).toBe(200)
        expect(res.data.ok).toBe(true)
      })

      it("PATCH item price rejects 0 with 400", async () => {
        const res = await api
          .patch(
            `/admin/sourcing/items/${itemId}/price`,
            { selling_price_mur: 0 },
            authed(),
          )
          .catch((e) => e.response)
        expect(res.status).toBe(400)
      })
    })
  },
})
