import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { followMovedPoints, reverseCanceled } from "../loyalty-maintenance"
import loyaltyReverseOnCancel from "../../subscribers/loyalty-reverse-on-cancel"
import { POST as reverseRoute } from "../../api/admin/loyalty/orders/[orderId]/reverse/route"

type Acc = { id: string; points_balance: number; lifetime_earned: number; lifetime_redeemed: number }

// A guest record whose 150 points moved to cus_m at sign-up; its order is then
// reversed (cancel or refund), which leaves the guest record at -150.
function fakeLoyalty(guestBalance: number, moveReason: string | null = "Moved to account cus_m") {
  const accounts: Record<string, Acc> = {
    cus_g: { id: "acc_g", points_balance: guestBalance, lifetime_earned: 150, lifetime_redeemed: 150 },
    cus_m: { id: "acc_m", points_balance: 250, lifetime_earned: 250, lifetime_redeemed: 0 },
  }
  const svc = {
    reversePointsForOrder: jest.fn(async () => ({ reversed: 150, balance: guestBalance })),
    ensureAccount: jest.fn(async (customerId: string) => accounts[customerId]),
    listLoyaltyTransactions: jest.fn(async () =>
      moveReason ? [{ type: "adjustment", points: -150, reason: moveReason, created_at: new Date() }] : [],
    ),
    updateLoyaltyAccounts: jest.fn(async (u: unknown) => u),
    createLoyaltyTransactions: jest.fn(async (t: unknown) => t),
  }
  return svc
}

describe("followMovedPoints", () => {
  it("takes a guest record's deficit from the account its points moved to", async () => {
    const svc = fakeLoyalty(-150)
    const result = await followMovedPoints(svc as any, "cus_g", { orderId: "o1", reason: "Order #7 cancelled" })
    expect(result).toEqual({ moved: 150, target: "cus_m" })
    expect(svc.updateLoyaltyAccounts).toHaveBeenCalledWith({
      id: "acc_g",
      points_balance: 0,
      lifetime_earned: 300,
    })
    expect(svc.createLoyaltyTransactions).toHaveBeenCalledWith({
      account_id: "acc_g",
      type: "adjustment",
      points: 150,
      reason: "Order #7 cancelled: taken from account cus_m instead",
      order_id: "o1",
    })
    expect(svc.updateLoyaltyAccounts).toHaveBeenCalledWith({
      id: "acc_m",
      points_balance: 100,
      lifetime_redeemed: 150,
    })
    expect(svc.createLoyaltyTransactions).toHaveBeenCalledWith({
      account_id: "acc_m",
      type: "adjustment",
      points: -150,
      reason: "Order #7 cancelled",
      order_id: "o1",
    })
  })

  it("does nothing when the guest record is not below zero", async () => {
    const svc = fakeLoyalty(0)
    expect(await followMovedPoints(svc as any, "cus_g", { orderId: "o1", reason: "r" })).toEqual({
      moved: 0,
      target: null,
    })
    expect(svc.updateLoyaltyAccounts).not.toHaveBeenCalled()
  })

  it("does nothing when the points never moved", async () => {
    const svc = fakeLoyalty(-150, null)
    expect(await followMovedPoints(svc as any, "cus_g", { orderId: "o1", reason: "r" })).toEqual({
      moved: 0,
      target: null,
    })
    expect(svc.createLoyaltyTransactions).not.toHaveBeenCalled()
  })
})

describe("every take-back follows moved points", () => {
  it("the cancel subscriber", async () => {
    const svc = fakeLoyalty(-150)
    const container = {
      resolve: (key: unknown) => {
        if (key === ContainerRegistrationKeys.LOGGER) return { info: jest.fn(), error: jest.fn() }
        if (key === Modules.ORDER) {
          return { retrieveOrder: async () => ({ id: "o1", display_id: 7, customer_id: "cus_g" }) }
        }
        return svc
      },
    }
    await loyaltyReverseOnCancel({ event: { data: { id: "o1" } }, container } as any)
    expect(svc.updateLoyaltyAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ id: "acc_m", points_balance: 100 }),
    )
  })

  it("the past clean-up (reverse-canceled)", async () => {
    const svc = fakeLoyalty(-150)
    await reverseCanceled(svc as any, [{ customer_id: "cus_g", order_id: "o1", display_id: 7, points: 150 }])
    expect(svc.updateLoyaltyAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ id: "acc_m", points_balance: 100 }),
    )
  })

  it("the refund reversal route", async () => {
    const svc = fakeLoyalty(-150)
    const res: any = { json: jest.fn(), status: jest.fn(() => res) }
    const scope = {
      resolve: (key: unknown) =>
        key === Modules.ORDER
          ? { retrieveOrder: async () => ({ id: "o1", display_id: 7, customer_id: "cus_g" }) }
          : svc,
    }
    await reverseRoute({ params: { orderId: "o1" }, body: {}, scope } as any, res)
    expect(svc.updateLoyaltyAccounts).toHaveBeenCalledWith(
      expect.objectContaining({ id: "acc_m", points_balance: 100 }),
    )
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reversed: 150, customer_id: "cus_g" }))
  })
})
