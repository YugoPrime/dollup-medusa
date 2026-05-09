import { recommendedPriceMur } from "../lib/price-formula"

describe("recommendedPriceMur", () => {
  it("rounds up to nearest round_step", () => {
    // cost_usd=10, fx=46, landed=1.5, markup=2.5, round=50
    // raw = 10 * 46 * 1.5 * 2.5 = 1725
    // ceil(1725/50)*50 = 1750
    expect(
      recommendedPriceMur({
        cost_usd: 10,
        fx_rate: 46,
        landed_mult: 1.5,
        markup: 2.5,
        round_step: 50,
      }),
    ).toBe(1750)
  })

  it("returns 0 for cost_usd <= 0", () => {
    expect(
      recommendedPriceMur({
        cost_usd: 0,
        fx_rate: 46,
        landed_mult: 1.5,
        markup: 2.5,
        round_step: 50,
      }),
    ).toBe(0)
    expect(
      recommendedPriceMur({
        cost_usd: -1,
        fx_rate: 46,
        landed_mult: 1.5,
        markup: 2.5,
        round_step: 50,
      }),
    ).toBe(0)
  })

  it("rounds exact multiples up to themselves", () => {
    // raw = 1750, round_step 50 → 1750
    expect(
      recommendedPriceMur({
        cost_usd: 1750 / (46 * 1.5 * 2.5),
        fx_rate: 46,
        landed_mult: 1.5,
        markup: 2.5,
        round_step: 50,
      }),
    ).toBe(1750)
  })

  it("works with round_step=1 (no rounding)", () => {
    expect(
      recommendedPriceMur({
        cost_usd: 1,
        fx_rate: 46,
        landed_mult: 1,
        markup: 1,
        round_step: 1,
      }),
    ).toBe(46)
  })

  it("respects round_step=100", () => {
    // raw = 5*46*1.5*2.5 = 862.5 → ceil(862.5/100)*100 = 900
    expect(
      recommendedPriceMur({
        cost_usd: 5,
        fx_rate: 46,
        landed_mult: 1.5,
        markup: 2.5,
        round_step: 100,
      }),
    ).toBe(900)
  })

  it("throws on non-positive multipliers", () => {
    expect(() =>
      recommendedPriceMur({
        cost_usd: 1,
        fx_rate: 0,
        landed_mult: 1.5,
        markup: 2.5,
        round_step: 50,
      }),
    ).toThrow()
    expect(() =>
      recommendedPriceMur({
        cost_usd: 1,
        fx_rate: 46,
        landed_mult: 1.5,
        markup: 2.5,
        round_step: 0,
      }),
    ).toThrow()
  })
})
