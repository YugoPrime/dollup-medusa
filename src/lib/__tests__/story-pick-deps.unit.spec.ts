import { gridSwapConflict } from "../story-pick-deps"

describe("gridSwapConflict", () => {
  it("refuses a story swap onto that day's grid product", () => {
    expect(gridSwapConflict(["p_grid"], "p_grid")).toMatch(/grid post/i)
  })
  it("allows any other product", () => {
    expect(gridSwapConflict(["p_grid"], "p_other")).toBeNull()
    expect(gridSwapConflict([], "p_other")).toBeNull()
  })
})
