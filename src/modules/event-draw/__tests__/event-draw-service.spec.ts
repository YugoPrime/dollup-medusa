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

      it("code format matches DUB-XXXXXX with the ambiguous-char-free alphabet", async () => {
        const codes = await service.generateCodeBatch(20, "batch-format")
        const pattern = /^DUB-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/
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

    describe("entry + bonus spins", () => {
      async function freshEntry() {
        const [code] = await service.generateCodeBatch(1, "b-entry")
        return service.createEntry({
          code, email: "a@b.com", phone: "+23050001111", consent: true,
        })
      }

      it("creates an entry with 1 spin and marks the code redeemed", async () => {
        const entry = await freshEntry()
        expect(entry).toMatchObject({ email: "a@b.com", spins_earned: 1, spins_used: 0 })
        const [code] = await service.listEventCodes({ code: entry.code })
        expect(code.redeemed_at).not.toBeNull()
      })

      it("rejects a second entry on the same code", async () => {
        const entry = await freshEntry()
        await expect(
          service.createEntry({ code: entry.code, email: "c@d.com", phone: "x", consent: true }),
        ).rejects.toThrow(/already used/i)
      })

      it("adds a review bonus spin once (idempotent)", async () => {
        const entry = await freshEntry()
        const after = await service.claimBonusSpin(entry.id, "review")
        expect(after.spins_earned).toBe(2)
        expect(after.review_bonus_claimed).toBe(true)
        const again = await service.claimBonusSpin(entry.id, "review")
        expect(again.spins_earned).toBe(2) // no double count
      })

      it("caps total spins at 3", async () => {
        const entry = await freshEntry()
        await service.claimBonusSpin(entry.id, "review")
        const capped = await service.claimBonusSpin(entry.id, "social")
        expect(capped.spins_earned).toBe(3)
      })

      it("requires email and phone", async () => {
        const [code] = await service.generateCodeBatch(1, "b-req")
        await expect(
          service.createEntry({ code, email: "", phone: "", consent: true }),
        ).rejects.toThrow(/email/i)
      })

      it("concurrent claims of the same bonus kind: spins_earned incremented exactly once", async () => {
        const entry = await freshEntry()
        const [a, b] = await Promise.all([
          service.claimBonusSpin(entry.id, "review"),
          service.claimBonusSpin(entry.id, "review"),
        ])
        expect(a.review_bonus_claimed).toBe(true)
        expect(b.review_bonus_claimed).toBe(true)
        // Whichever call "won" the race, the final stored state must reflect
        // exactly one increment — not two.
        const final = await service.retrieveEventEntry(entry.id)
        expect(final.spins_earned).toBe(2)
      })

      it("review + social claims cap at 3, never exceeding the hard cap", async () => {
        const entry = await freshEntry()
        await service.claimBonusSpin(entry.id, "review")
        await service.claimBonusSpin(entry.id, "social")
        const final = await service.retrieveEventEntry(entry.id)
        expect(final.spins_earned).toBe(3)
        expect(final.review_bonus_claimed).toBe(true)
        expect(final.social_bonus_claimed).toBe(true)
      })
    })

    describe("settings + spin", () => {
      it("returns default weights on first read", async () => {
        const s = await service.getSettings()
        expect(s.weights.pts_50).toBeGreaterThan(0)
        expect(s.active_draw_period).toMatch(/^\d{4}-\d{2}$/)
      })

      it("spin consumes a spin and records a reward deterministically", async () => {
        const [code] = await service.generateCodeBatch(1, "b-spin")
        const entry = await service.createEntry({ code, email: "s@p.com", phone: "1", consent: true })
        // force rng=0 → first slice in the weighted order
        const result = await service.spin(entry.id, () => 0)
        expect(result.slice).toBeDefined()
        const after = await service.retrieveEventEntry(entry.id)
        expect(after.spins_used).toBe(1)
        const rewards = await service.listEventRewards({ entry_id: entry.id })
        expect(rewards).toHaveLength(1)
      })

      it("spin() returns the reward_id of the exact EventReward row it created", async () => {
        const [code] = await service.generateCodeBatch(1, "b-spin-reward-id")
        const entry = await service.createEntry({
          code, email: "rid@p.com", phone: "1", consent: true,
        })
        const result = await service.spin(entry.id, () => 0)
        expect(result.reward_id).toBeTruthy()

        const [reward] = await service.listEventRewards({ entry_id: entry.id })
        expect(reward.id).toBe(result.reward_id)
        expect(reward.idempotency_key).toBe(`${entry.id}:0`)
      })

      it("draw_entry slice creates a draw ticket for the active period", async () => {
        await service.updateSettings({ weights: { draw_entry: 1 } }) // only draw slice
        const [code] = await service.generateCodeBatch(1, "b-draw")
        const entry = await service.createEntry({ code, email: "d@p.com", phone: "1", consent: true })
        const result = await service.spin(entry.id, () => 0.5)
        expect(result.type).toBe("draw_entry")
        const tickets = await service.listEventDrawEntries({ entry_id: entry.id })
        expect(tickets).toHaveLength(1)
      })

      it("rejects a spin when none are left", async () => {
        await service.updateSettings({ weights: { pts_50: 1 } })
        const [code] = await service.generateCodeBatch(1, "b-none")
        const entry = await service.createEntry({ code, email: "n@p.com", phone: "1", consent: true })
        await service.spin(entry.id, () => 0) // uses the only base spin
        await expect(service.spin(entry.id, () => 0)).rejects.toThrow(/no spins/i)
      })

      it("concurrent spins: exactly one consumes the only spin and records exactly one reward", async () => {
        await service.updateSettings({ weights: { pts_50: 1 } }) // points-only slice
        const [code] = await service.generateCodeBatch(1, "b-concurrent-spin")
        const entry = await service.createEntry({
          code, email: "cs@p.com", phone: "1", consent: true,
        })

        const results = await Promise.allSettled([
          service.spin(entry.id, () => 0),
          service.spin(entry.id, () => 0),
          service.spin(entry.id, () => 0),
        ])

        const fulfilled = results.filter((r) => r.status === "fulfilled")
        const rejected = results.filter((r) => r.status === "rejected")
        expect(fulfilled).toHaveLength(1)
        expect(rejected).toHaveLength(2)
        for (const r of rejected as PromiseRejectedResult[]) {
          expect(r.reason.message).toMatch(/no spins/i)
        }

        const final = await service.retrieveEventEntry(entry.id)
        expect(final.spins_used).toBe(1)
        const rewards = await service.listEventRewards({ entry_id: entry.id })
        expect(rewards).toHaveLength(1)
      })
    })

    describe("transaction atomicity", () => {
      it("spin rolls back the spin consumption when reward creation fails", async () => {
        await service.updateSettings({ weights: { pts_50: 1 } })
        const [code] = await service.generateCodeBatch(1, "b-spin-rollback")
        const entry = await service.createEntry({
          code, email: "rb@p.com", phone: "1", consent: true,
        })

        // `service` is a container-resolved handle that re-resolves a fresh
        // underlying instance on every property access (see the
        // forced-collision test above for the full explanation), so we
        // patch the shared class prototype rather than the resolved
        // instance, and restore it in `finally` no matter what.
        const ServiceClass = EventDrawModuleService as any
        const originalCreateEventRewards = ServiceClass.prototype.createEventRewards
        ServiceClass.prototype.createEventRewards = async function createEventRewards() {
          throw new Error("forced reward-write failure")
        }

        try {
          await expect(service.spin(entry.id, () => 0)).rejects.toThrow(
            /forced reward-write failure/,
          )
        } finally {
          ServiceClass.prototype.createEventRewards = originalCreateEventRewards
        }

        // The consume-spin UPDATE must have rolled back with the reward
        // write it shared a transaction with — spins_used stays at 0 and no
        // spin was silently burned.
        const after = await service.retrieveEventEntry(entry.id)
        expect(after.spins_used).toBe(0)
        const rewards = await service.listEventRewards({ entry_id: entry.id })
        expect(rewards).toHaveLength(0)
      })

      it("createEntry rolls back the code redemption when entry creation fails", async () => {
        const [code] = await service.generateCodeBatch(1, "b-entry-rollback")

        const ServiceClass = EventDrawModuleService as any
        const originalCreateEventEntries = ServiceClass.prototype.createEventEntries
        ServiceClass.prototype.createEventEntries = async function createEventEntries() {
          throw new Error("forced entry-write failure")
        }

        try {
          await expect(
            service.createEntry({ code, email: "e@r.com", phone: "1", consent: true }),
          ).rejects.toThrow(/forced entry-write failure/)
        } finally {
          ServiceClass.prototype.createEventEntries = originalCreateEventEntries
        }

        // The redeem UPDATE must have rolled back with the entry-create it
        // shared a transaction with — the code is still unredeemed and can
        // be retried, instead of being permanently burned with no entry.
        const [stored] = await service.listEventCodes({ code })
        expect(stored.redeemed_at).toBeNull()

        // And it's genuinely reusable now that the rollback restored it.
        const entry = await service.createEntry({
          code, email: "e2@r.com", phone: "1", consent: true,
        })
        expect(entry.email).toBe("e2@r.com")
      })

      it("getSettings under concurrent first-callers: all resolve to the same row, only one persisted", async () => {
        const results = await Promise.allSettled([
          service.getSettings(),
          service.getSettings(),
          service.getSettings(),
        ])
        for (const r of results) {
          expect(r.status).toBe("fulfilled")
        }
        const periods = new Set(
          (results as PromiseFulfilledResult<Awaited<ReturnType<typeof service.getSettings>>>[])
            .map((r) => r.value.active_draw_period),
        )
        expect(periods.size).toBe(1)

        const rows = await (service as any).listEventSettings({ singleton: "default" })
        expect(rows).toHaveLength(1)
      })

      it("pickSlice guard: an all-zero weight table throws INVALID_DATA, not a TypeError", async () => {
        await service.updateSettings({
          weights: { pts_50: 0, pts_100: 0, pts_200: 0, draw_entry: 0, gift: 0 },
        })
        const [code] = await service.generateCodeBatch(1, "b-zero-weights")
        const entry = await service.createEntry({
          code, email: "z@p.com", phone: "1", consent: true,
        })
        await expect(service.spin(entry.id, () => 0)).rejects.toThrow(
          /no active slices/i,
        )
        // The guard must fire before any write — the spin was not consumed.
        const after = await service.retrieveEventEntry(entry.id)
        expect(after.spins_used).toBe(0)
      })
    })
  },
})
