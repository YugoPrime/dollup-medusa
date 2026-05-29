import { computeDeposit } from "../preorder-deposit"

describe("computeDeposit", () => {
  it("rounds 75% up to nearest Rs 50", () => {
    expect(computeDeposit(1000, 150)).toEqual({ total: 1150, deposit: 900, balance: 250 })
  })
  it("handles exact multiples", () => {
    expect(computeDeposit(800, 0)).toEqual({ total: 800, deposit: 600, balance: 200 })
  })
  it("rounds a non-multiple 75% up to nearest 50", () => {
    expect(computeDeposit(890, 70)).toEqual({ total: 960, deposit: 750, balance: 210 })
  })
  it("caps deposit at total and handles zero", () => {
    expect(computeDeposit(0, 0)).toEqual({ total: 0, deposit: 0, balance: 0 })
  })
})
