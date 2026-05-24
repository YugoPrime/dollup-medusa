import { computePreorderPrice, DEFAULT_PREORDER_SETTINGS } from "../lib/pricing"

describe("computePreorderPrice", () => {
  const settings = DEFAULT_PREORDER_SETTINGS

  it("computes the example $4 item (low band)", () => {
    const result = computePreorderPrice({ sheinPriceUsd: 4 }, settings)
    expect(result.sheinPriceMur).toBe(200)
    expect(result.customsAmount).toBe(50)
    expect(result.landedCost).toBe(250)
    expect(result.handlingFee).toBe(150)
    expect(result.rawPrice).toBe(400)
    expect(result.finalPriceMur).toBe(400)
  })

  it("computes the example $8 item (Rs 500-999 band)", () => {
    const result = computePreorderPrice({ sheinPriceUsd: 8 }, settings)
    expect(result.landedCost).toBe(500)
    expect(result.handlingFee).toBe(300)
    expect(result.finalPriceMur).toBe(800)
  })

  it("computes the example $16 item (Rs 1000-1999 band)", () => {
    const result = computePreorderPrice({ sheinPriceUsd: 16 }, settings)
    expect(result.landedCost).toBe(1000)
    expect(result.handlingFee).toBe(600)
    expect(result.finalPriceMur).toBe(1600)
  })

  it("computes the example $32 item (Rs 2000+ band, flat 1000 wins)", () => {
    const result = computePreorderPrice({ sheinPriceUsd: 32 }, settings)
    expect(result.landedCost).toBe(2000)
    expect(result.handlingFee).toBe(1000)
    expect(result.finalPriceMur).toBe(3000)
  })

  it("computes the example $60 item (Rs 2000+ band, 30% beats flat)", () => {
    const result = computePreorderPrice({ sheinPriceUsd: 60 }, settings)
    expect(result.landedCost).toBe(3750)
    expect(result.handlingFee).toBe(1125)
    expect(result.rawPrice).toBe(4875)
    expect(result.finalPriceMur).toBe(4880)
  })

  it("rounds UP to nearest 10 (never down)", () => {
    const result = computePreorderPrice({ sheinPriceUsd: 4.01 }, settings)
    expect(result.finalPriceMur).toBe(410)
  })

  it("respects fx_rate override", () => {
    const result = computePreorderPrice(
      { sheinPriceUsd: 4 },
      { ...settings, fx_rate_usd_to_mur: 55 },
    )
    expect(result.sheinPriceMur).toBe(220)
    expect(result.landedCost).toBe(275)
    expect(result.finalPriceMur).toBe(430)
  })

  it("throws on negative USD price", () => {
    expect(() =>
      computePreorderPrice({ sheinPriceUsd: -1 }, settings),
    ).toThrow(/positive/i)
  })

  it("throws on non-finite USD price", () => {
    expect(() =>
      computePreorderPrice({ sheinPriceUsd: NaN }, settings),
    ).toThrow(/finite/i)
  })

  it("throws on zero USD price (treated as invalid)", () => {
    expect(() =>
      computePreorderPrice({ sheinPriceUsd: 0 }, settings),
    ).toThrow(/positive/i)
  })
})
