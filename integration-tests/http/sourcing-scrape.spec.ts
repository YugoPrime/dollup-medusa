import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
jest.setTimeout(60 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api }) => {
    let token = ""
    beforeAll(async () => {
      const reg = await api.post("/auth/user/emailpass/register", {
        email: "scrape-admin@dollup.test",
        password: "supersecret",
      })
      token = reg.data.token
    })

    it("returns ok:false reason:invalid_url for empty payload", async () => {
      const r = await api.post(
        "/admin/sourcing/scrape",
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(r.status).toBe(200)
      expect(r.data.ok).toBe(false)
      expect(r.data.reason).toBe("invalid_url")
    })

    it("returns ok:false reason:invalid_url for non-http", async () => {
      const r = await api.post(
        "/admin/sourcing/scrape",
        { url: "ftp://example.com" },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(r.data.ok).toBe(false)
      expect(r.data.reason).toBe("invalid_url")
    })

    it("never returns 500 even on totally bogus host", async () => {
      const r = await api.post(
        "/admin/sourcing/scrape",
        { url: "https://this-host-definitely-does-not-exist.invalid" },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(r.status).toBe(200)
      expect(r.data.ok).toBe(false)
    })
  },
})
