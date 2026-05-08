import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
jest.setTimeout(60 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let token = ""

    beforeAll(async () => {
      const reg = await api.post("/auth/user/emailpass/register", {
        email: "admin@dollup.test",
        password: "supersecret",
      })
      token = reg.data.token

      const container = getContainer()
      const userModule = container.resolve("user")
      const existing = await userModule.listUsers({ email: "admin@dollup.test" })
      if (existing.length === 0) {
        await userModule.createUsers({ email: "admin@dollup.test" })
      }
    })

    function authed(headers: Record<string, string> = {}) {
      return { headers: { Authorization: `Bearer ${token}`, ...headers } }
    }

    describe("Sourcing suppliers API", () => {
      it("creates and lists suppliers", async () => {
        const create = await api.post(
          "/admin/sourcing/suppliers",
          { name: "Cool Factory", contact_handle: "cool_factory" },
          authed(),
        )
        expect(create.status).toBe(200)
        expect(create.data.supplier.id).toMatch(/^supp_/)

        const list = await api.get("/admin/sourcing/suppliers", authed())
        expect(list.status).toBe(200)
        const ids = list.data.suppliers.map((s: { id: string }) => s.id)
        expect(ids).toContain(create.data.supplier.id)
      })

      it("rejects empty name with 400", async () => {
        const res = await api
          .post("/admin/sourcing/suppliers", { name: "  " }, authed())
          .catch((e) => e.response)
        expect(res.status).toBe(400)
      })

      it("archives via PATCH", async () => {
        const created = await api.post(
          "/admin/sourcing/suppliers",
          { name: "Archive Me" },
          authed(),
        )
        const archived = await api.patch(
          `/admin/sourcing/suppliers/${created.data.supplier.id}`,
          { archived: true },
          authed(),
        )
        expect(archived.data.supplier.archived_at).toBeTruthy()
      })

      it("returns 401 without auth", async () => {
        const res = await api
          .get("/admin/sourcing/suppliers")
          .catch((e) => e.response)
        expect(res.status).toBe(401)
      })
    })
  },
})
