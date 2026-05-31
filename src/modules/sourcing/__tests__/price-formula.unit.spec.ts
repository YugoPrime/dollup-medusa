import { recommendedPriceMur } from "../lib/price-formula"

describe("recommendedPriceMur", () => {
  // ---- legacy behaviour: flat_add omitted (defaults to 0) ----
  it("rounds up to nearest round_step (flat_add defaults to 0)", () => {
    // cost_usd=10, fx=46, landed=1.5, markup=2.5, round=50
    // raw = (10 * 46 * 1.5 + 0) * 2.5 = 1725
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

  // ---- boutique formula: ((cost * 51) + 200) * 2, no rounding ----
  it("applies flat_add before markup (boutique formula)", () => {
    // (5.25 * 51 * 1 + 200) * 2 = (267.75 + 200) * 2 = 935.5
    expect(
      recommendedPriceMur({
        cost_usd: 5.25,
        fx_rate: 51,
        landed_mult: 1,
        flat_add: 200,
        markup: 2,
        round_step: 1,
      }),
    ).toBe(936) // ceil(935.5/1)*1 = 936  (round_step=1 rounds up to next integer)
  })

  it("boutique formula matches across costs", () => {
    const f = (c: number) =>
      recommendedPriceMur({
        cost_usd: c,
        fx_rate: 51,
        landed_mult: 1,
        flat_add: 200,
        markup: 2,
        round_step: 1,
      })
    // 4.45 -> (4.45*51+200)*2 = (226.95+200)*2 = 853.9 -> ceil = 854
    expect(f(4.45)).toBe(854)
    // 0.85 -> (0.85*51+200)*2 = (43.35+200)*2 = 486.7 -> ceil = 487
    expect(f(0.85)).toBe(487)
  })

  it("flat_add=0 reproduces the legacy multiplicative result", () => {
    const withZero = recommendedPriceMur({
      cost_usd: 7,
      fx_rate: 46,
      landed_mult: 1.5,
      flat_add: 0,
      markup: 2.5,
      round_step: 50,
    })
    const omitted = recommendedPriceMur({
      cost_usd: 7,
      fx_rate: 46,
      landed_mult: 1.5,
      markup: 2.5,
      round_step: 50,
    })
    expect(withZero).toBe(omitted)
  })

  it("throws on negative flat_add", () => {
    expect(() =>
      recommendedPriceMur({
        cost_usd: 1,
        fx_rate: 46,
        landed_mult: 1.5,
        flat_add: -1,
        markup: 2.5,
        round_step: 50,
      }),
    ).toThrow()
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
    // raw = (cost * 46 * 1.5 + 0) * 2.5 = 1750, round_step 50 → 1750
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
