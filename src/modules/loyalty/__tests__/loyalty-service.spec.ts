import { moduleIntegrationTestRunner } from "@medusajs/test-utils"

import { LOYALTY_MODULE } from "../index"
import LoyaltyModuleService from "../service"

jest.setTimeout(60 * 1000)

moduleIntegrationTestRunner<LoyaltyModuleService>({
  moduleName: LOYALTY_MODULE,
  resolve: "./src/modules/loyalty",
  testSuite: ({ service }) => {
    describe("LoyaltyModuleService", () => {
      describe("ensureAccount", () => {
        it("creates a fresh account for a new customer", async () => {
          const account = await service.ensureAccount("cus_a")
          expect(account).toMatchObject({
            customer_id: "cus_a",
            points_balance: 0,
            lifetime_earned: 0,
            lifetime_redeemed: 0,
          })
        })

        it("is idempotent — returns the same account on second call", async () => {
          const a = await service.ensureAccount("cus_b")
          const b = await service.ensureAccount("cus_b")
          expect(b.id).toEqual(a.id)
        })
      })

      describe("awardPoints", () => {
        it("credits balance + lifetime_earned and writes a ledger row", async () => {
          await service.awardPoints("cus_award", 25, {
            orderId: "ord_1",
            reason: "Order #1001 completed",
          })
          const acct = await service.getAccount("cus_award")
          expect(acct.points_balance).toBe(25)
          expect(acct.lifetime_earned).toBe(25)
          expect(acct.lifetime_redeemed).toBe(0)

          const { items, count } = await service.listTransactions("cus_award", {})
          expect(count).toBe(1)
          expect(items[0]).toMatchObject({
            type: "earn",
            points: 25,
            order_id: "ord_1",
          })
        })

        it("is idempotent on the same order_id", async () => {
          await service.awardPoints("cus_idem", 10, {
            orderId: "ord_idem",
            reason: "Order #2002 completed",
          })
          await service.awardPoints("cus_idem", 10, {
            orderId: "ord_idem",
            reason: "Order #2002 completed (re-emit)",
          })
          const acct = await service.getAccount("cus_idem")
          expect(acct.points_balance).toBe(10)
          expect(acct.lifetime_earned).toBe(10)

          const { count } = await service.listTransactions("cus_idem", {})
          expect(count).toBe(1)
        })

        it("rejects non-positive points", async () => {
          await expect(
            service.awardPoints("cus_x", 0, { reason: "nope" }),
          ).rejects.toThrow()
          await expect(
            service.awardPoints("cus_x", -5, { reason: "nope" }),
          ).rejects.toThrow()
        })
      })

      describe("redeemPoints", () => {
        it("happy path: decrements balance, increments lifetime_redeemed, writes ledger", async () => {
          await service.awardPoints("cus_redeem", 100, {
            orderId: "ord_seed",
            reason: "seed",
          })
          await service.redeemPoints("cus_redeem", 30, {
            reason: "Checkout discount",
          })
          const acct = await service.getAccount("cus_redeem")
          expect(acct.points_balance).toBe(70)
          expect(acct.lifetime_earned).toBe(100)
          expect(acct.lifetime_redeemed).toBe(30)

          const { items } = await service.listTransactions("cus_redeem", {})
          // newest-first; redeem should be first.
          expect(items[0]).toMatchObject({ type: "redeem", points: -30 })
        })

        it("throws when balance is insufficient", async () => {
          await service.awardPoints("cus_low", 5, {
            orderId: "ord_low",
            reason: "seed small",
          })
          await expect(
            service.redeemPoints("cus_low", 10, { reason: "too much" }),
          ).rejects.toThrow(/insufficient/i)

          // balance unchanged, no ledger row added
          const acct = await service.getAccount("cus_low")
          expect(acct.points_balance).toBe(5)
          expect(acct.lifetime_redeemed).toBe(0)
        })
      })

      describe("adjustPoints", () => {
        it("credits on positive delta and updates lifetime_earned", async () => {
          await service.adjustPoints("cus_adj1", 50, { reason: "Goodwill" })
          const acct = await service.getAccount("cus_adj1")
          expect(acct.points_balance).toBe(50)
          expect(acct.lifetime_earned).toBe(50)
          expect(acct.lifetime_redeemed).toBe(0)
        })

        it("debits on negative delta and updates lifetime_redeemed", async () => {
          await service.awardPoints("cus_adj2", 80, {
            orderId: "ord_adj2",
            reason: "seed",
          })
          await service.adjustPoints("cus_adj2", -20, {
            reason: "Correction",
          })
          const acct = await service.getAccount("cus_adj2")
          expect(acct.points_balance).toBe(60)
          expect(acct.lifetime_earned).toBe(80)
          expect(acct.lifetime_redeemed).toBe(20)
        })

        it("refuses to push the balance below zero", async () => {
          await service.awardPoints("cus_adj3", 10, {
            orderId: "ord_adj3",
            reason: "seed",
          })
          await expect(
            service.adjustPoints("cus_adj3", -50, { reason: "too negative" }),
          ).rejects.toThrow()
          const acct = await service.getAccount("cus_adj3")
          expect(acct.points_balance).toBe(10)
        })
      })
    })
  },
})
