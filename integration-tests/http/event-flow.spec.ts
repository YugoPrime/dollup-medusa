import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ApiKeyType, Modules } from "@medusajs/framework/utils"

import { EVENT_DRAW_MODULE } from "../../src/modules/event-draw"

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

      // kept in the same `it` as the happy path to avoid a multi-test Redis
      // teardown flake (see credit-event-spin.spec.ts for the same pattern)
      const unknown = await api
        .post("/store/event/validate-code", { code: "DUB-ZZZZ" }, pubKeyHeaders)
        .catch((e: any) => e.response)
      expect(unknown.status).toBe(400)
    })
  },
})
