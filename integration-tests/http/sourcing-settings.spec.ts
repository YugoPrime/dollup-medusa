import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
jest.setTimeout(60 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let token = ""

    beforeAll(async () => {
      const reg = await api.post("/auth/user/emailpass/register", {
        email: "settings-admin@dollup.test",
        password: "supersecret",
      })
      token = reg.data.token

      const container = getContainer()
      const userModule = container.resolve("user")
      const existing = await userModule.listUsers({
        email: "settings-admin@dollup.test",
      })
      if (existing.length === 0) {
        await userModule.createUsers({ email: "settings-admin@dollup.test" })
      }
    })

    function authed(headers: Record<string, string> = {}) {
      return { headers: { Authorization: `Bearer ${token}`, ...headers } }
    }

    describe("Sourcing settings API", () => {
      it("GET returns defaults", async () => {
        const res = await api.get("/admin/sourcing/settings", authed())
        expect(res.status).toBe(200)
        expect(res.data.settings.fx_rate).toBe(46)
      })

      it("PUT updates and persists", async () => {
        const put = await api.put(
          "/admin/sourcing/settings",
          { fx_rate: 47, round_step: 100 },
          authed(),
        )
        expect(put.status).toBe(200)
        expect(put.data.settings.fx_rate).toBe(47)
        expect(put.data.settings.round_step).toBe(100)

        const get = await api.get("/admin/sourcing/settings", authed())
        expect(get.data.settings.fx_rate).toBe(47)
        expect(get.data.settings.round_step).toBe(100)
      })

      it("PUT rejects bad input (fx_rate=0)", async () => {
        const res = await api
          .put("/admin/sourcing/settings", { fx_rate: 0 }, authed())
          .catch((e) => e.response)
        expect(res.status).toBe(400)
      })
    })
  },
})
