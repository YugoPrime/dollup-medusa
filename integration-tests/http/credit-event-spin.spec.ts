import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

import { creditEventSpinPoints } from "../../src/workflows/credit-event-spin"
import { EVENT_DRAW_MODULE } from "../../src/modules/event-draw"
import { LOYALTY_MODULE } from "../../src/modules/loyalty"

jest.setTimeout(1800 * 1000) // 30 min — Windows Postgres DDL migrations are slow

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ getContainer }) => {
    describe("creditEventSpinPoints", () => {
      it("creates a customer, credits points, is idempotent", async () => {
        const container = getContainer()
        const eventSvc: any = container.resolve(EVENT_DRAW_MODULE)
        const loyalty: any = container.resolve(LOYALTY_MODULE)

        const [code] = await eventSvc.generateCodeBatch(1, "wf")
        const entry = await eventSvc.createEntry({
          code,
          email: "wf@x.com",
          phone: "1",
          consent: true,
        })
        const [reward] = await eventSvc.createEventRewards([
          {
            entry_id: entry.id,
            slice: "pts_100",
            type: "points",
            points: 100,
            status: "issued",
            idempotency_key: `${entry.id}:0`,
          },
        ])

        const first = await creditEventSpinPoints(container, {
          entryId: entry.id,
          email: "wf@x.com",
          points: 100,
          rewardId: reward.id,
        })
        expect(first.credited).toBe(100)
        expect(first.customer_id).toBeTruthy()

        const acct = await loyalty.getAccount(first.customer_id)
        expect(acct.points_balance).toBe(100)

        // entry + reward should be updated
        const [updatedEntry] = await eventSvc.listEventEntries({ id: entry.id })
        expect(updatedEntry.customer_id).toBe(first.customer_id)
        const [updatedReward] = await eventSvc.listEventRewards({ id: reward.id })
        expect(updatedReward.status).toBe("credited")

        // idempotent re-run must NOT double-credit
        const second = await creditEventSpinPoints(container, {
          entryId: entry.id,
          email: "wf@x.com",
          points: 100,
          rewardId: reward.id,
        })
        expect(second.customer_id).toBe(first.customer_id)
        const acct2 = await loyalty.getAccount(first.customer_id)
        expect(acct2.points_balance).toBe(100)

        // ── awarding 0 points is a no-op success but still marks reward credited ──
        // (kept in the same `it` to avoid a multi-test Redis teardown flake)
        const [zeroCode] = await eventSvc.generateCodeBatch(1, "wf0")
        const zeroEntry = await eventSvc.createEntry({
          code: zeroCode,
          email: "wf-zero@x.com",
          phone: "1",
          consent: true,
        })
        const [zeroReward] = await eventSvc.createEventRewards([
          {
            entry_id: zeroEntry.id,
            slice: "gift",
            type: "gift",
            points: 0,
            status: "issued",
            idempotency_key: `${zeroEntry.id}:0`,
          },
        ])

        const zeroResult = await creditEventSpinPoints(container, {
          entryId: zeroEntry.id,
          email: "wf-zero@x.com",
          points: 0,
          rewardId: zeroReward.id,
        })
        expect(zeroResult.credited).toBe(0)

        const zeroAcct = await loyalty.getAccount(zeroResult.customer_id)
        expect(zeroAcct.points_balance).toBe(0)

        const [updatedZeroReward] = await eventSvc.listEventRewards({
          id: zeroReward.id,
        })
        expect(updatedZeroReward.status).toBe("credited")
      })
    })
  },
})
