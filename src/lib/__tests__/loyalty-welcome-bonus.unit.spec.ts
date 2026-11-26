import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import loyaltyWelcomeBonus from "../../subscribers/loyalty-welcome-bonus"
import { LOYALTY_MODULE } from "../../modules/loyalty"

describe("loyalty-welcome-bonus subscriber", () => {
  let customer: Record<string, unknown>
  let account: Record<string, unknown>
  const awardPoints = jest.fn()
  const adjustPoints = jest.fn()
  const raw = jest.fn()
  const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
  const container = {
    resolve: (key: unknown) => {
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      if (key === ContainerRegistrationKeys.QUERY) {
        return { graph: async () => ({ data: [customer] }) }
      }
      if (key === ContainerRegistrationKeys.PG_CONNECTION) return { raw }
      if (key === LOYALTY_MODULE) {
        return {
          getSettings: async () => ({ welcome_bonus_points: 100 }),
          getAccount: async () => account,
          awardPoints,
          adjustPoints,
        }
      }
      throw new Error(`unexpected resolve ${String(key)}`)
    },
  }
  const run = () => loyaltyWelcomeBonus({ event: { data: { id: "cus_1" } }, container } as any)

  beforeEach(() => {
    jest.clearAllMocks()
    customer = { id: "cus_1", has_account: true }
    account = { lifetime_earned: 0, points_balance: 0 }
    adjustPoints.mockResolvedValue({})
  })

  it("gives the welcome bonus, then moves the guest points in", async () => {
    raw.mockResolvedValue({
      rows: [{ target_customer_id: "cus_1", source_customer_id: "cus_g", points: "40" }],
    })
    await run()
    expect(awardPoints).toHaveBeenCalledWith("cus_1", 100, { reason: "Welcome bonus on signup" })
    expect(raw.mock.calls[0][1]).toEqual(["cus_1"])
    expect(adjustPoints).toHaveBeenCalledWith("cus_g", -40, { reason: "Moved to account cus_1" })
    expect(adjustPoints).toHaveBeenCalledWith("cus_1", 40, {
      reason: "Points from orders before your account",
    })
    expect(awardPoints.mock.invocationCallOrder[0]).toBeLessThan(
      adjustPoints.mock.invocationCallOrder[0],
    )
  })

  it("on a second run gives no second bonus and moves nothing twice", async () => {
    account = { lifetime_earned: 140, points_balance: 140 }
    raw.mockResolvedValue({ rows: [] })
    await run()
    expect(awardPoints).not.toHaveBeenCalled()
    expect(raw).toHaveBeenCalled()
    expect(adjustPoints).not.toHaveBeenCalled()
  })

  it("still gives the welcome bonus when the move fails", async () => {
    raw.mockRejectedValue(new Error("db down"))
    await expect(run()).resolves.toBeUndefined()
    expect(awardPoints).toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalled()
  })

  it("does nothing for a guest checkout record", async () => {
    customer = { id: "cus_1", has_account: false }
    await run()
    expect(awardPoints).not.toHaveBeenCalled()
    expect(raw).not.toHaveBeenCalled()
  })
})
