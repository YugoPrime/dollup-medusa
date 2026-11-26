import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import loyaltyReverseOnCancel, { config } from "../../subscribers/loyalty-reverse-on-cancel"

describe("loyalty-reverse-on-cancel subscriber", () => {
  let order: Record<string, unknown>
  const reversePointsForOrder = jest.fn()
  const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
  const container = {
    resolve: (key: unknown) => {
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      if (key === Modules.ORDER) return { retrieveOrder: async () => order }
      return {
        reversePointsForOrder,
        ensureAccount: async () => ({ id: "acc", points_balance: 0, lifetime_earned: 0, lifetime_redeemed: 0 }),
        listLoyaltyTransactions: async () => [],
        updateLoyaltyAccounts: async () => ({}),
        createLoyaltyTransactions: async () => ({}),
      }
    },
  }
  const run = () =>
    loyaltyReverseOnCancel({ event: { data: { id: "order_1" } }, container } as any)

  beforeEach(() => {
    reversePointsForOrder.mockReset()
    logger.error.mockReset()
  })

  it("listens to order.canceled", () => {
    expect(config.event).toBe("order.canceled")
  })

  it("takes back the points of a cancelled order", async () => {
    order = { id: "order_1", display_id: 101, customer_id: "cus_1" }
    reversePointsForOrder.mockResolvedValue({ reversed: 39, balance: 0 })
    await run()
    expect(reversePointsForOrder).toHaveBeenCalledWith("cus_1", "order_1", {
      reason: "Order #101 cancelled",
    })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it("does nothing for an order without a customer", async () => {
    order = { id: "order_1", display_id: 101, customer_id: null }
    await run()
    expect(reversePointsForOrder).not.toHaveBeenCalled()
  })

  it("logs and swallows a loyalty failure", async () => {
    order = { id: "order_1", display_id: 101, customer_id: "cus_1" }
    reversePointsForOrder.mockRejectedValue(new Error("db down"))
    await expect(run()).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
  })
})
