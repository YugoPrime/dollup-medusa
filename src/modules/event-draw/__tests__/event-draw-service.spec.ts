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

      it("forced collision: mapped unique-violation on insert still retries to a full, distinct batch", async () => {
        // Persist a code up front — this is the code we'll force the batch
        // generator to collide with.
        const [dupeCode] = await service.generateCodeBatch(1, "collision-seed")

        // `service` here is a container-resolved handle that re-resolves a
        // fresh underlying instance on every property access, so patching
        // an own property on it (or `jest.spyOn`-ing it) never reaches the
        // instance actually executing inside `generateCodeBatch`. Patching
        // the shared class prototype instead affects every instance,
        // including ones resolved later in the same call.
        const ServiceClass = EventDrawModuleService as any
        const originalRandomCode = ServiceClass.prototype.randomCode
        const originalListEventCodes = ServiceClass.prototype.listEventCodes

        // Force the very first rolled candidate to be that already-taken
        // code; every later roll falls through to the real RNG.
        let randomCalls = 0
        ServiceClass.prototype.randomCode = function randomCode(this: unknown) {
          randomCalls++
          return randomCalls === 1 ? dupeCode : originalRandomCode.call(this)
        }

        // Simulate the pre-check losing its check-then-act race: report the
        // forced-duplicate code as "free" on its one pre-check lookup (as if
        // a concurrent caller inserted it a moment after the check), so the
        // insert actually reaches Postgres and trips the real unique-index
        // violation. That's the exact path `isUniqueViolation` regressed on
        // (Medusa maps it to a `MedusaError` before it reaches our catch),
        // so a full, distinct batch coming back here proves the mapped-error
        // catch-and-retry branch fired, not just the cheap pre-check.
        let precheckRaced = false
        ServiceClass.prototype.listEventCodes = async function listEventCodes(
          this: unknown,
          ...args: any[]
        ) {
          const [filters] = args
          if (!precheckRaced && filters?.code === dupeCode) {
            precheckRaced = true
            return [] as any
          }
          return originalListEventCodes.apply(this, args)
        }

        try {
          const codes = await service.generateCodeBatch(5, "batch-forced-collision")

          expect(codes).toHaveLength(5)
          expect(new Set(codes).size).toBe(5)
          // The forced duplicate must have been retried away, not returned.
          expect(codes).not.toContain(dupeCode)
          // More rolls than `count` happened — proves at least one retry.
          expect(randomCalls).toBeGreaterThan(5)
          expect(precheckRaced).toBe(true)
        } finally {
          ServiceClass.prototype.randomCode = originalRandomCode
          ServiceClass.prototype.listEventCodes = originalListEventCodes
        }

        const stored = await service.listEventCodes({ batch_id: "batch-forced-collision" })
        expect(stored).toHaveLength(5)
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
