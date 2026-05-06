import { DRAFT_ORDER_STATUSES } from "../models/draft-order"
import { SOURCE_TYPES } from "../models/draft-item"
import { SOURCING_MODULE } from "../index"

describe("sourcing module constants", () => {
  it("exposes the module name", () => {
    expect(SOURCING_MODULE).toBe("sourcing")
  })

  it("declares the 5 draft order statuses in expected order", () => {
    expect(DRAFT_ORDER_STATUSES).toEqual([
      "drafting",
      "negotiating",
      "paid",
      "shipped",
      "received",
    ])
  })

  it("declares the 3 source types", () => {
    expect(SOURCE_TYPES).toEqual(["alibaba", "pdf", "manual"])
  })
})
