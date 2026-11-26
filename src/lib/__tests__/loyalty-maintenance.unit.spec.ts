import {
  findUnreversedCanceledEarns,
  reverseCanceled,
} from "../loyalty-maintenance"

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
