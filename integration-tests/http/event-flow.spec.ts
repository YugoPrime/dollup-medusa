import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ApiKeyType, Modules } from "@medusajs/framework/utils"

import { EVENT_DRAW_MODULE } from "../../src/modules/event-draw"
import { LOYALTY_MODULE } from "../../src/modules/loyalty"
import LoyaltyModuleService from "../../src/modules/loyalty/service"

jest.setTimeout(90 * 1000)

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let pubKeyHeaders: { headers: Record<string, string> }

    beforeAll(async () => {
      // /store/* routes require a valid publishable API key on every
      // request (global framework middleware, not opt-outable per-route —
      // see src/api/middlewares.ts comment). Mint one for these tests.
      const apiKeyService: any = getContainer().resolve(Modules.API_KEY)
      const [key] = await apiKeyService.createApiKeys([
        {
          title: "event-flow test key",
          type: ApiKeyType.PUBLISHABLE,
          created_by: "event-flow.spec",
        },
      ])
      pubKeyHeaders = { headers: { "x-publishable-api-key": key.token } }
    })

    it("runs the full loop over HTTP", async () => {
      const svc: any = getContainer().resolve(EVENT_DRAW_MODULE)
      await svc.updateSettings({ weights: { pts_100: 1 } }) // deterministic points slice
      const [code] = await svc.generateCodeBatch(1, "http")

      const valid = await api.post(
        "/store/event/validate-code",
        { code },
        pubKeyHeaders,
      )
      expect(valid.status).toBe(200)

      const enter = await api.post(
        "/store/event/enter",
        { code, email: "http@x.com", phone: "+2305", consent: true },
        pubKeyHeaders,
      )
      expect(enter.status).toBe(200)
      const entryId = enter.data.entry_id
      expect(enter.data.spins_remaining).toBe(1)

      const bonus = await api.post(
        "/store/event/bonus-spin",
        { entry_id: entryId, kind: "review" },
        pubKeyHeaders,
      )
      expect(bonus.data.spins_remaining).toBe(2)

      const spin = await api.post(
        "/store/event/spin",
        { entry_id: entryId },
        pubKeyHeaders,
      )
      expect(spin.status).toBe(200)
      expect(spin.data.points).toBe(100)
      expect(spin.data.spins_remaining).toBe(1)
      expect(spin.data.credited).toBe(100)

      // Independent verification: read the ACTUAL loyalty account balance
      // via the loyalty service directly, rather than trusting the echoed
      // `credited` value on the spin response. This is what would have
      // caught a reward-attribution bug where the route credited a
      // different reward's id than the one this spin actually created (see
      // the reward_id-threading comment in
      // src/api/store/event/spin/route.ts) — the response could still
      // report `credited: 100` while the wrong EventReward row got marked
      // "credited" and the real one got stranded at "issued".
      const eventSvc: any = getContainer().resolve(EVENT_DRAW_MODULE)
      const loyalty: any = getContainer().resolve(LOYALTY_MODULE)
      const [creditedEntry] = await eventSvc.listEventEntries({ id: entryId })
      expect(creditedEntry.customer_id).toBeTruthy()
      const account = await loyalty.getAccount(creditedEntry.customer_id)
      expect(account.points_balance).toBe(100)

      const [creditedReward] = await eventSvc.listEventRewards({
        entry_id: entryId,
        status: "credited",
      })
      expect(creditedReward).toBeTruthy()
      expect(creditedReward.points).toBe(100)

      // kept in the same `it` as the happy path to avoid a multi-test Redis
      // teardown flake (see credit-event-spin.spec.ts for the same pattern)
      const unknown = await api
        .post("/store/event/validate-code", { code: "DUB-ZZZZ" }, pubKeyHeaders)
        .catch((e: any) => e.response)
      expect(unknown.status).toBe(400)

      // ── bonus-spin: missing/invalid entry_id → 400, not a 500 ───────────
      const badBonus = await api
        .post("/store/event/bonus-spin", { kind: "review" }, pubKeyHeaders)
        .catch((e: any) => e.response)
      expect(badBonus.status).toBe(400)

      const badBonusEmpty = await api
        .post(
          "/store/event/bonus-spin",
          { entry_id: "   ", kind: "review" },
          pubKeyHeaders,
        )
        .catch((e: any) => e.response)
      expect(badBonusEmpty.status).toBe(400)

      // ── spin credit failure must NOT report a misleading spin failure ───
      // The spin itself (consume + reward write) succeeds; only the
      // subsequent `creditEventSpinPoints` call is forced to fail (by
      // patching `LoyaltyModuleService.prototype.awardPoints`, the same
      // prototype-patching pattern the module-level spec uses — a
      // container-resolved service handle re-resolves a fresh instance on
      // every property access, so patching the shared class prototype is
      // what actually reaches the instance running inside the request).
      // The route must still return 200 with `credit_pending: true` and
      // `credited: 0`, and the spin/reward must be left exactly as a
      // successful spin would leave them — NOT rolled back — since the
      // spin already happened before the credit step ran.
      await svc.updateSettings({ weights: { pts_100: 1 } })
      const [creditFailCode] = await svc.generateCodeBatch(1, "credit-fail")
      const creditFailEnter = await api.post(
        "/store/event/enter",
        {
          code: creditFailCode,
          email: "credit-fail@x.com",
          phone: "+2305",
          consent: true,
        },
        pubKeyHeaders,
      )
      const creditFailEntryId = creditFailEnter.data.entry_id

      const LoyaltyModuleServiceClass = LoyaltyModuleService as any
      const originalAwardPoints = LoyaltyModuleServiceClass.prototype.awardPoints
      LoyaltyModuleServiceClass.prototype.awardPoints =
        async function awardPoints() {
          throw new Error("forced loyalty credit failure")
        }

      let creditFailSpin: any
      try {
        creditFailSpin = await api.post(
          "/store/event/spin",
          { entry_id: creditFailEntryId },
          pubKeyHeaders,
        )
      } finally {
        LoyaltyModuleServiceClass.prototype.awardPoints = originalAwardPoints
      }

      expect(creditFailSpin.status).toBe(200)
      expect(creditFailSpin.data.points).toBe(100)
      expect(creditFailSpin.data.credited).toBe(0)
      expect(creditFailSpin.data.credit_pending).toBe(true)
      expect(creditFailSpin.data.spins_remaining).toBe(0)

      // The spin was genuinely consumed (not rolled back) ...
      const [creditFailEntry] = await eventSvc.listEventEntries({
        id: creditFailEntryId,
      })
      expect(creditFailEntry.spins_used).toBe(1)

      // ... and the reward row exists at "issued", still awaiting credit —
      // this is exactly what an admin would need to reconcile manually.
      const [creditFailReward] = await eventSvc.listEventRewards({
        entry_id: creditFailEntryId,
      })
      expect(creditFailReward).toBeTruthy()
      expect(creditFailReward.status).toBe("issued")
      expect(creditFailReward.points).toBe(100)

      // A retry against the now-healthy credit path must NOT be able to
      // spin again (no spins left) — proving the earlier spin really was
      // consumed, not silently un-burned by the credit failure.
      const retrySpin = await api
        .post(
          "/store/event/spin",
          { entry_id: creditFailEntryId },
          pubKeyHeaders,
        )
        .catch((e: any) => e.response)
      expect(retrySpin.status).toBe(409)
    })
  },
})
