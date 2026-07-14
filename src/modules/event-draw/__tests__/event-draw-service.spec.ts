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
  },
})
