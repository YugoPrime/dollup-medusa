import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import {
  ContainerRegistrationKeys,
  Modules,
  generateJwtToken,
} from "@medusajs/framework/utils"
import { EVENT_DRAW_MODULE } from "../../src/modules/event-draw"

jest.setTimeout(90 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let token = ""

    // NOTE on admin auth: the pattern used by other specs in this repo
    // (leads-admin-routes.spec.ts, chat-admin-routes.spec.ts) — POST
    // /auth/user/emailpass/register, then use the returned token as a
    // Bearer — does NOT work against the installed @medusajs/medusa
    // 2.13.1. Verified by reading
    // node_modules/@medusajs/medusa/dist/api/auth/utils/generate-jwt-token.js:
    // register() only creates an AuthIdentity, not a linked User, so the
    // JWT's actor_id is baked in as "" (no user_id in app_metadata yet).
    // node_modules/@medusajs/framework/dist/http/middlewares/authenticate-middleware.js
    // then rejects any request with a falsy actor_id unless the route sets
    // allowUnregistered (admin routes don't) — 401. Reproduced independently
    // by re-running the pre-existing, untouched leads-admin-routes.spec.ts,
    // which now fails the same way on every authenticated call. There is
    // also no createAdminUser (or similar) helper in the installed
    // @medusajs/test-utils@2.13.1 (checked `Object.keys(require(...))`).
    //
    // Working alternative: create a real User via the User module directly,
    // then mint a JWT the same way Medusa's own
    // generateJwtTokenForAuthIdentity does (actor_id = the real user id),
    // using the exported generateJwtToken utility + the app's own jwtSecret
    // from the config module. authenticate-middleware only verifies the JWT
    // signature + actor_id/actor_type, so this produces a token
    // indistinguishable from one issued through the normal login flow.
    beforeAll(async () => {
      const container = getContainer()
      const userModule = container.resolve(Modules.USER)
      const user = await userModule.createUsers({
        email: "event-admin@dollup.test",
        first_name: "Event",
        last_name: "Admin",
      })
      const configModule = container.resolve(
        ContainerRegistrationKeys.CONFIG_MODULE,
      )
      const { http } = configModule.projectConfig
      token = generateJwtToken(
        {
          actor_id: user.id,
          actor_type: "user",
          auth_identity_id: "",
          app_metadata: { user_id: user.id },
        },
        {
          secret: http.jwtSecret,
          expiresIn: http.jwtExpiresIn,
          jwtOptions: http.jwtOptions,
        },
      )
    })

    const auth = () => ({ headers: { Authorization: `Bearer ${token}` } })

    // Kept in a single `it` to avoid a multi-test Redis teardown flake — see
    // the same pattern/comment in credit-event-spin.spec.ts and
    // event-flow.spec.ts.
    it("covers auth + codes / entries / draw / settings admin routes end to end", async () => {
      // ── auth sanity: no token → 401 ──────────────────────────────────────
      const unauthed = await api
        .get("/admin/event/settings")
        .catch((e: { response: unknown }) => e.response)
      expect((unauthed as { status: number }).status).toBe(401)

      // ── codes: POST generates a batch, GET filters by batch_id ──────────
      const gen = await api.post(
        "/admin/event/codes",
        { count: 3, batch_id: "adm" },
        auth(),
      )
      expect(gen.status).toBe(200)
      expect(gen.data.codes).toHaveLength(3)

      await api.post(
        "/admin/event/codes",
        { count: 2, batch_id: "batch-filter" },
        auth(),
      )
      const filtered = await api.get(
        "/admin/event/codes?batch_id=batch-filter",
        auth(),
      )
      expect(filtered.status).toBe(200)
      expect(filtered.data.codes).toHaveLength(2)
      for (const c of filtered.data.codes as Array<{ batch_id: string }>) {
        expect(c.batch_id).toBe("batch-filter")
      }

      // ── settings: GET has default weights, POST updates them ────────────
      const settings = await api.get("/admin/event/settings", auth())
      expect(settings.status).toBe(200)
      expect(settings.data.weights.pts_50).toBeGreaterThan(0)

      const updated = await api.post(
        "/admin/event/settings",
        { weights: { pts_50: 99 }, active_draw_period: "2099-01" },
        auth(),
      )
      expect(updated.status).toBe(200)
      expect(updated.data.weights.pts_50).toBe(99)
      expect(updated.data.active_draw_period).toBe("2099-01")

      // ── entries: GET returns entries + count ─────────────────────────────
      const entries = await api.get("/admin/event/entries", auth())
      expect(entries.status).toBe(200)
      expect(Array.isArray(entries.data.entries)).toBe(true)
      expect(typeof entries.data.count).toBe("number")

      // ── draw: GET filters by period, POST marks a winner ────────────────
      const svc: any = getContainer().resolve(EVENT_DRAW_MODULE)
      const entry = await svc.createEventEntries({
        code: "DUB-ADM1",
        email: "draw-admin@dollup.test",
        phone: "+2305",
        consent: true,
        spins_earned: 1,
        spins_used: 0,
        ip: null,
      })
      const drawEntry = await svc.createEventDrawEntries({
        entry_id: entry.id,
        draw_period: "2099-01",
      })

      const listRes = await api.get(
        "/admin/event/draw?period=2099-01",
        auth(),
      )
      expect(listRes.status).toBe(200)
      expect(Array.isArray(listRes.data.entries)).toBe(true)
      expect(
        (listRes.data.entries as Array<{ id: string }>).some(
          (e) => e.id === drawEntry.id,
        ),
      ).toBe(true)

      const winRes = await api.post(
        "/admin/event/draw",
        { draw_entry_id: drawEntry.id },
        auth(),
      )
      expect(winRes.status).toBe(200)
      expect(winRes.data.winner.is_winner).toBe(true)

      // ── draw: POST with a missing/invalid draw_entry_id → 400 ───────────
      const badDraw = await api
        .post("/admin/event/draw", {}, auth())
        .catch((e: { response: unknown }) => e.response)
      expect((badDraw as { status: number }).status).toBe(400)

      // ── draw: POST with an unknown draw_entry_id → 404 ───────────────────
      const notFoundDraw = await api
        .post(
          "/admin/event/draw",
          { draw_entry_id: "evtdrawentry_does_not_exist" },
          auth(),
        )
        .catch((e: { response: unknown }) => e.response)
      expect((notFoundDraw as { status: number }).status).toBe(404)

      // ── rewards: GET returns rewards + count, filterable by type/status ─
      const giftReward = await svc.createEventRewards({
        entry_id: entry.id,
        slice: "gift",
        type: "gift",
        points: 0,
        status: "issued",
        idempotency_key: `${entry.id}:gift`,
      })
      const pointsReward = await svc.createEventRewards({
        entry_id: entry.id,
        slice: "pts_50",
        type: "points",
        points: 50,
        status: "credited",
        idempotency_key: `${entry.id}:points`,
      })

      const rewardsRes = await api.get("/admin/event/rewards", auth())
      expect(rewardsRes.status).toBe(200)
      expect(typeof rewardsRes.data.count).toBe("number")
      const ids = (rewardsRes.data.rewards as Array<{ id: string }>).map(
        (r) => r.id,
      )
      expect(ids).toContain(giftReward.id)
      expect(ids).toContain(pointsReward.id)

      const giftIssuedRes = await api.get(
        "/admin/event/rewards?type=gift&status=issued",
        auth(),
      )
      expect(giftIssuedRes.status).toBe(200)
      const giftIssuedIds = (
        giftIssuedRes.data.rewards as Array<{ id: string; type: string; status: string }>
      ).map((r) => r.id)
      expect(giftIssuedIds).toContain(giftReward.id)
      expect(giftIssuedIds).not.toContain(pointsReward.id)
      for (const r of giftIssuedRes.data.rewards as Array<{
        type: string
        status: string
      }>) {
        expect(r.type).toBe("gift")
        expect(r.status).toBe("issued")
      }
    })
  },
})
