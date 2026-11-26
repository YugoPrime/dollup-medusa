import {
  findGuestPointRows,
  findUnreversedCanceledEarns,
  moveGuestPoints,
  reverseCanceled,
} from "../loyalty-maintenance"

describe("loyalty maintenance: guest points", () => {
  it("matches guest rows to the account by email, ignoring case", async () => {
    const raw = jest.fn().mockResolvedValue({
      rows: [{ target_customer_id: "cus_m", source_customer_id: "cus_g1", points: "40" }],
    })
    const rows = await findGuestPointRows({ raw })
    const sql = raw.mock.calls[0][0] as string
    expect(sql).toContain("lower(g.email) = lower(r.email)")
    expect(sql).toContain("g.has_account = false")
    expect(sql).toContain("a.points_balance > 0")
    expect(raw.mock.calls[0][1]).toEqual([])
    expect(rows).toEqual([{ target_customer_id: "cus_m", source_customer_id: "cus_g1", points: 40 }])
  })

  it("limits the search to one account when asked", async () => {
    const raw = jest.fn().mockResolvedValue({ rows: [] })
    await findGuestPointRows({ raw }, "cus_m")
    expect(raw.mock.calls[0][0]).toContain("and r.id = ?")
    expect(raw.mock.calls[0][1]).toEqual(["cus_m"])
  })

  it("moves each guest balance into the account", async () => {
    const adjustPoints = jest.fn().mockResolvedValue({})
    const result = await moveGuestPoints({ adjustPoints }, [
      { target_customer_id: "cus_m", source_customer_id: "cus_g1", points: 40 },
      { target_customer_id: "cus_m", source_customer_id: "cus_g2", points: 20 },
    ])
    expect(adjustPoints.mock.calls).toEqual([
      ["cus_g1", -40, { reason: "Moved to account cus_m" }],
      ["cus_m", 40, { reason: "Points from orders before your account" }],
      ["cus_g2", -20, { reason: "Moved to account cus_m" }],
      ["cus_m", 20, { reason: "Points from orders before your account" }],
    ])
    expect(result).toEqual({ people: 1, points: 60 })
  })

  it("does not credit the account when the guest debit fails", async () => {
    const adjustPoints = jest.fn().mockRejectedValueOnce(new Error("below zero"))
    const result = await moveGuestPoints({ adjustPoints }, [
      { target_customer_id: "cus_m", source_customer_id: "cus_g1", points: 40 },
    ])
    expect(adjustPoints).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ people: 0, points: 0 })
  })

  it("gives the points back to the guest row when the credit fails", async () => {
    const adjustPoints = jest
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({})
    const result = await moveGuestPoints({ adjustPoints }, [
      { target_customer_id: "cus_m", source_customer_id: "cus_g1", points: 40 },
    ])
    expect(adjustPoints).toHaveBeenLastCalledWith("cus_g1", 40, {
      reason: "Move to account cus_m failed, points restored",
    })
    expect(result).toEqual({ people: 0, points: 0 })
  })
})

describe("loyalty maintenance: cancelled orders", () => {
  it("finds earn rows on cancelled orders that were never taken back", async () => {
    const raw = jest.fn().mockResolvedValue({
      rows: [{ customer_id: "cus_1", order_id: "o1", display_id: 7, points: "30" }],
    })
    const rows = await findUnreversedCanceledEarns({ raw })
    const sql = raw.mock.calls[0][0] as string
    expect(sql).toContain("t.type = 'earn'")
    expect(sql).toContain("o.canceled_at is not null")
    expect(sql).toContain("r.points < 0")
    expect(rows).toEqual([{ customer_id: "cus_1", order_id: "o1", display_id: 7, points: 30 }])
  })

  it("reverses each row and counts what was taken back", async () => {
    const reversePointsForOrder = jest.fn().mockResolvedValue({ reversed: 30, balance: 0 })
    const result = await reverseCanceled({ reversePointsForOrder }, [
      { customer_id: "cus_1", order_id: "o1", display_id: 7, points: "30" as unknown as number },
    ])
    expect(reversePointsForOrder).toHaveBeenCalledWith("cus_1", "o1", {
      reason: "Order #7 cancelled",
    })
    expect(result).toEqual({ orders: 1, points: 30 })
  })

  it("keeps going when one row fails and does not count it", async () => {
    const reversePointsForOrder = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ reversed: 12, balance: 0 })
    const result = await reverseCanceled({ reversePointsForOrder }, [
      { customer_id: "cus_1", order_id: "o1", display_id: 7, points: 30 },
      { customer_id: "cus_2", order_id: "o2", display_id: null, points: 12 },
    ])
    expect(reversePointsForOrder).toHaveBeenCalledTimes(2)
    expect(reversePointsForOrder).toHaveBeenLastCalledWith("cus_2", "o2", {
      reason: "Order #o2 cancelled",
    })
    expect(result).toEqual({ orders: 1, points: 12 })
  })
})
