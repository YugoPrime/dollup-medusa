import { resolveRotationStart } from "../grid-planner"

describe("resolveRotationStart", () => {
  const rows = [
    { post_date: "2026-11-02", metadata: { rotation_category: "dresses" } },
    { post_date: "2026-11-03", metadata: { rotation_category: "lingerie" } },
    { post_date: "2026-11-05", metadata: null },
  ]

  it("returns the category of the latest row before the date", () => {
    expect(resolveRotationStart(rows, "2026-11-04")).toBe("lingerie")
  })

  it("returns null when that row has no category (next is dresses)", () => {
    expect(resolveRotationStart(rows, "2026-11-06")).toBeNull()
  })

  it("returns null with no earlier rows", () => {
    expect(resolveRotationStart([], "2026-11-01")).toBeNull()
  })

  it("ignores rows on or after the date, whatever their order", () => {
    const shuffled = [rows[2], rows[0], rows[1]]
    expect(resolveRotationStart(shuffled, "2026-11-03")).toBe("dresses")
  })
})
