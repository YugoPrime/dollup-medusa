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

      it("code format matches DUB-XXXX with the ambiguous-char-free alphabet", async () => {
        const codes = await service.generateCodeBatch(20, "batch-format")
        const pattern = /^DUB-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/
        for (const code of codes) {
          expect(code).toMatch(pattern)
        }
      })

      it("rejects out-of-bounds counts", async () => {
        await expect(service.generateCodeBatch(0, "batch-zero")).rejects.toThrow(
          /count must be 1\.\.5000|invalid/i,
        )
        await expect(service.generateCodeBatch(5001, "batch-toobig")).rejects.toThrow(
          /count must be 1\.\.5000|invalid/i,
        )
      })

      it("concurrent redemptions of the same code: exactly one succeeds", async () => {
        const [code] = await service.generateCodeBatch(1, "batch-race")
        const results = await Promise.allSettled([
          service.redeemCode(code),
          service.redeemCode(code),
        ])
        const fulfilled = results.filter((r) => r.status === "fulfilled")
        const rejected = results.filter((r) => r.status === "rejected")
        expect(fulfilled).toHaveLength(1)
        expect(rejected).toHaveLength(1)
        expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/already/i)

        const [stored] = await service.listEventCodes({ code })
        expect(stored.redeemed_at).not.toBeNull()
      })

      it("concurrent batch generation: 2N distinct codes persisted, neither call throws", async () => {
        const [batchA, batchB] = await Promise.all([
          service.generateCodeBatch(25, "batch-concurrent-a"),
          service.generateCodeBatch(25, "batch-concurrent-b"),
        ])
        expect(batchA).toHaveLength(25)
        expect(batchB).toHaveLength(25)

        const all = [...batchA, ...batchB]
        expect(new Set(all).size).toBe(50)

        const storedA = await service.listEventCodes({ batch_id: "batch-concurrent-a" })
        const storedB = await service.listEventCodes({ batch_id: "batch-concurrent-b" })
        expect(storedA).toHaveLength(25)
        expect(storedB).toHaveLength(25)
      })
    })
  },
})
