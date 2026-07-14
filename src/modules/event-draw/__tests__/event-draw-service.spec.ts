import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { EVENT_DRAW_MODULE } from "../index"
import EventDrawModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<EventDrawModuleService>({
  moduleName: EVENT_DRAW_MODULE,
  resolve: "./src/modules/event-draw",
  testSuite: ({ service }) => {
    describe("EventDrawModuleService scaffold", () => {
      it("creates and lists an event code", async () => {
        await service.createEventCodes({ code: "DUB-AAAA", batch_id: "b1" })
        const codes = await service.listEventCodes({ code: "DUB-AAAA" })
        expect(codes).toHaveLength(1)
        expect(codes[0]).toMatchObject({ code: "DUB-AAAA", batch_id: "b1", redeemed_at: null })
      })
    })

    describe("code batch + redemption", () => {
      it("generates the requested number of unique codes", async () => {
        const codes = await service.generateCodeBatch(5, "batch-x")
        expect(new Set(codes).size).toBe(5)
        const stored = await service.listEventCodes({ batch_id: "batch-x" })
        expect(stored).toHaveLength(5)
      })

      it("redeems a code once, then rejects re-redemption", async () => {
        const [code] = await service.generateCodeBatch(1, "batch-y")
        const first = await service.redeemCode(code.toLowerCase()) // case-insensitive
        expect(first.code).toBe(code)
        await expect(service.redeemCode(code)).rejects.toThrow(/already/i)
      })

      it("rejects an unknown code", async () => {
        await expect(service.redeemCode("DUB-NOPE")).rejects.toThrow(/not found|invalid/i)
      })
    })
  },
})
