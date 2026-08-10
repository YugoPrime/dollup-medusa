import { costMicros } from "../lib/cost"

describe("costMicros", () => {
  it("prices uncached input at $3/MTok and output at $15/MTok", () => {
    // 1M input + 1M output = $3 + $15 = $18 = 18_000_000 micro-dollars
    expect(costMicros({ input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(18_000_000)
  })

  it("prices cache reads at one tenth of the input rate", () => {
    // 1M cache-read tokens = $0.30 = 300_000 micro-dollars
    expect(
      costMicros({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 }),
    ).toBe(300_000)
  })

  it("prices cache writes at 1.25x the input rate", () => {
    // 1M cache-write tokens = $3.75 = 3_750_000 micro-dollars
    expect(
      costMicros({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 }),
    ).toBe(3_750_000)
  })

  it("sums all four components", () => {
    expect(
      costMicros({
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
      }),
    ).toBe(18_000_000 + 300_000 + 3_750_000)
  })

  it("returns an integer for a realistic small run", () => {
    const out = costMicros({
      input_tokens: 900,
      output_tokens: 180,
      cache_read_input_tokens: 3_400,
    })
    expect(Number.isInteger(out)).toBe(true)
    expect(out).toBe(900 * 3 + 180 * 15 + Math.round(3_400 * 3 * 0.1))
  })

  it("treats missing cache fields as zero", () => {
    expect(costMicros({ input_tokens: 100, output_tokens: 100 })).toBe(100 * 3 + 100 * 15)
  })

  it("is zero for an empty usage object", () => {
    expect(costMicros({ input_tokens: 0, output_tokens: 0 })).toBe(0)
  })

  it("never returns a negative or fractional value from odd input", () => {
    const out = costMicros({
      input_tokens: -50,
      output_tokens: 1.4,
      cache_read_input_tokens: Number.NaN,
      cache_creation_input_tokens: undefined,
    } as never)
    expect(Number.isInteger(out)).toBe(true)
    expect(out).toBeGreaterThanOrEqual(0)
  })

  it("a cache read is an order of magnitude cheaper than the same tokens uncached", () => {
    const cached = costMicros({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 10_000 })
    const uncached = costMicros({ input_tokens: 10_000, output_tokens: 0 })
    expect(cached * 10).toBe(uncached)
  })
})
