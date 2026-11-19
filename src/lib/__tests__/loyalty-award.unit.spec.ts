import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import loyaltyAwardSubscriber from "../../subscribers/loyalty-award"

const base = {
  id: "order_1",
  display_id: 101,
  customer_id: "cus_1",
  currency_code: "mur",
  total: 1950,
}

describe("loyalty-award subscriber", () => {
  let order: Record<string, unknown>
  const awardPoints = jest.fn()
  const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
  const container = {
    resolve: (key: unknown) => {
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      if (key === Modules.ORDER) return { retrieveOrder: async () => order }
      return { getSettings: async () => ({ earn_rate_per_100_mur: 2 }), awardPoints }
    },
  }

  beforeEach(() => {
    awardPoints.mockReset()
  })

  it("doubles a website order on 7 Dec", async () => {
    order = { ...base, created_at: new Date("2026-12-07T06:00:00Z"), metadata: { cart_type: "instock" } }
    await loyaltyAwardSubscriber({ event: { data: { id: "order_1" } }, container } as any)
    expect(awardPoints).toHaveBeenCalledWith("cus_1", 78, {
      orderId: "order_1",
      reason: "Order #101 completed (double points)",
    })
  })

  it("single for a DM order on 7 Dec", async () => {
    order = { ...base, created_at: new Date("2026-12-07T06:00:00Z"), metadata: { dm_status: "confirmed" } }
    await loyaltyAwardSubscriber({ event: { data: { id: "order_1" } }, container } as any)
    expect(awardPoints).toHaveBeenCalledWith("cus_1", 39, {
      orderId: "order_1",
      reason: "Order #101 completed",
    })
  })

  it("single for a website order on 8 Dec", async () => {
    order = { ...base, created_at: new Date("2026-12-08T06:00:00Z"), metadata: { cart_type: "instock" } }
    await loyaltyAwardSubscriber({ event: { data: { id: "order_1" } }, container } as any)
    expect(awardPoints).toHaveBeenCalledWith("cus_1", 39, {
      orderId: "order_1",
      reason: "Order #101 completed",
    })
  })
})
