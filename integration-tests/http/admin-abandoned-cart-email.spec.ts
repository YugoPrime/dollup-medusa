import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"

jest.setTimeout(1800 * 1000) // 30 min — Windows Postgres DDL migrations are slow

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let token = ""
    let cartId = ""
    let noEmailCartId = ""

    beforeAll(async () => {
      // ── Auth ──────────────────────────────────────────────────────────────
      const reg = await api.post("/auth/user/emailpass/register", {
        email: "cart-email-admin@dollup.test",
        password: "supersecret",
      })
      token = reg.data.token

      // ── Seed carts via cart module (no store-API region/sales-channel dep) ─
      const cartModule: any = getContainer().resolve(Modules.CART)

      const withEmail = await cartModule.createCarts({
        currency_code: "mur",
        email: "shopper@dollup.test",
      })
      cartId = withEmail.id

      const withoutEmail = await cartModule.createCarts({
        currency_code: "mur",
      })
      noEmailCartId = withoutEmail.id
    })

    const auth = () => ({ headers: { Authorization: `Bearer ${token}` } })

    // ── 1. Auth guard ─────────────────────────────────────────────────────────

    describe("POST /admin/abandoned-carts/:id/email — auth guard", () => {
      it("returns 401 when no token is provided", async () => {
        const res = await api
          .post(`/admin/abandoned-carts/${cartId}/email`, {
            template: "checkin",
          })
          .catch((e: { response: unknown }) => e.response)
        expect((res as { status: number }).status).toBe(401)
      })
    })

    // ── 2. Validation — bad template ──────────────────────────────────────────

    describe("POST /admin/abandoned-carts/:id/email — validation", () => {
      it("returns 400 for an invalid template value", async () => {
        const res = await api
          .post(
            `/admin/abandoned-carts/${cartId}/email`,
            { template: "promo" },
            auth(),
          )
          .catch((e: { response: unknown }) => e.response)
        expect((res as { status: number }).status).toBe(400)
      })

      it("returns 400 when cart has no email", async () => {
        const res = await api
          .post(
            `/admin/abandoned-carts/${noEmailCartId}/email`,
            { template: "checkin" },
            auth(),
          )
          .catch((e: { response: unknown }) => e.response)
        expect((res as { status: number }).status).toBe(400)
        expect((res as { data: { message: string } }).data.message).toMatch(
          /no email/i,
        )
      })

      it("returns 404 for a non-existent cart id", async () => {
        const res = await api
          .post(
            "/admin/abandoned-carts/cart_does_not_exist/email",
            { template: "checkin" },
            auth(),
          )
          .catch((e: { response: unknown }) => e.response)
        expect((res as { status: number }).status).toBe(404)
      })
    })

    // ── 3. Happy-path: checkin ────────────────────────────────────────────────

    describe("POST /admin/abandoned-carts/:id/email — checkin template", () => {
      it("returns 200 with sent_at even when no email provider is configured", async () => {
        const res = await api.post(
          `/admin/abandoned-carts/${cartId}/email`,
          { template: "checkin" },
          auth(),
        )
        expect(res.status).toBe(200)
        expect(typeof res.data.sent_at).toBe("string")
        // No coupon fields on a checkin
        expect(res.data.code).toBeUndefined()
        expect(res.data.expires_at).toBeUndefined()
      })

      it("writes the recovery_emails entry to cart metadata", async () => {
        const cartModule: any = getContainer().resolve(Modules.CART)
        const [cart] = await cartModule.listCarts(
          { id: cartId },
          { select: ["id", "metadata"] },
        )
        const entries: Array<{ template: string; sent_at: string }> =
          cart.metadata?.recovery_emails ?? []
        expect(entries.length).toBeGreaterThanOrEqual(1)
        const checkinEntry = entries.find((e) => e.template === "checkin")
        expect(checkinEntry).toBeTruthy()
        expect(typeof checkinEntry!.sent_at).toBe("string")
      })

      it("returns 409 when the same template is sent twice to the same cart", async () => {
        const res = await api
          .post(
            `/admin/abandoned-carts/${cartId}/email`,
            { template: "checkin" },
            auth(),
          )
          .catch((e: { response: unknown }) => e.response)
        expect((res as { status: number }).status).toBe(409)
        expect(
          (res as { data: { message: string } }).data.message,
        ).toMatch(/already sent/i)
      })
    })
  },
})
