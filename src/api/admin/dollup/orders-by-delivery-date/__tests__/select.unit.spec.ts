import {
  createdSinceFor,
  idsWithDeliveryDateBetween,
  parseDayRange,
} from "../select"

describe("parseDayRange", () => {
  it("accepts a from/to pair of calendar days", () => {
    expect(parseDayRange({ from: "2026-11-27", to: "2026-12-03" })).toEqual({
      from: "2026-11-27",
      to: "2026-12-03",
    })
  })

  it("accepts a single day", () => {
    expect(parseDayRange({ from: "2026-11-30", to: "2026-11-30" })).toEqual({
      from: "2026-11-30",
      to: "2026-11-30",
    })
  })

  it.each<[Record<string, unknown>, string]>([
    [{}, "missing"],
    [{ from: "2026-11-30" }, "missing to"],
    [{ from: "30/11/2026", to: "2026-11-30" }, "not yyyy-mm-dd"],
    [{ from: "2026-02-31", to: "2026-03-01" }, "not a real day"],
    [{ from: ["2026-11-30"], to: "2026-11-30" }, "repeated param"],
    [{ from: "2026-12-03", to: "2026-11-27" }, "from after to"],
    [{ from: "2026-01-01", to: "2026-12-31" }, "longer than two months"],
  ])("rejects %j (%s)", (query) => {
    expect(parseDayRange(query)).toHaveProperty("error")
  })
})

describe("idsWithDeliveryDateBetween", () => {
  const order = (
    id: string,
    metadata: Record<string, unknown> | null,
    status = "pending",
  ) => ({ id, status, metadata })

  it("keeps orders whose delivery day is inside the range, ends included", () => {
    const ids = idsWithDeliveryDateBetween(
      [
        order("before", { delivery_date: "2026-11-26" }),
        order("first", { delivery_date: "2026-11-27" }),
        order("old-923", { delivery_date: "2026-11-30" }),
        order("last", { delivery_date: "2026-12-03" }),
        order("after", { delivery_date: "2026-12-04" }),
      ],
      "2026-11-27",
      "2026-12-03",
    )
    expect(ids).toEqual(["first", "old-923", "last"])
  })

  it("skips cancelled orders and orders with no delivery day", () => {
    const ids = idsWithDeliveryDateBetween(
      [
        order("cancelled", { delivery_date: "2026-11-30" }, "canceled"),
        order("undated", {}),
        order("no-metadata", null),
        order("blank", { delivery_date: "" }),
        order("not-a-string", { delivery_date: 20261130 }),
        order("kept", { delivery_date: "2026-11-30" }),
      ],
      "2026-11-30",
      "2026-11-30",
    )
    expect(ids).toEqual(["kept"])
  })
})

describe("createdSinceFor", () => {
  it("reaches back a year before the first delivery day, in Mauritius time", () => {
    // Noon MU on 30 Nov 2026 is 08:00 UTC; a year back from there.
    expect(createdSinceFor("2026-11-30")).toBe("2025-11-30T08:00:00.000Z")
  })
})
