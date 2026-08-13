import { costMicros } from "../lib/cost"
import { DEFAULT_MODEL, KNOWN_MODELS, MODEL_PRICING } from "../lib/pricing"

// AI_AGENT_MODEL is unset in .env.test, so the no-model-argument cases below
// price at DEFAULT_MODEL (claude-sonnet-5, $3/$15).
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

// The regression this parameter exists to prevent: AI_AGENT_MODEL used to be
// configurable while these rates were hardcoded to Sonnet 5, so running on
// Haiku billed 3x the real spend and exhausted the monthly budget after a third
// of the conversations it was sized for.
describe("costMicros — per model", () => {
  const usage = {
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000,
  }

  it("bills Haiku 4.5 at exactly one third of Sonnet 5 across every component", () => {
    expect(costMicros(usage, "claude-haiku-4-5") * 3).toBe(
      costMicros(usage, "claude-sonnet-5"),
    )
  })

  it("bills Opus 5 above Sonnet 5", () => {
    expect(costMicros(usage, "claude-opus-5")).toBeGreaterThan(
      costMicros(usage, "claude-sonnet-5"),
    )
  })

  it("uses the configured model when none is passed", () => {
    expect(costMicros(usage)).toBe(costMicros(usage, DEFAULT_MODEL))
  })

  it("never bills an unknown model below the priciest known one", () => {
    const unknown = costMicros(usage, "claude-not-a-real-model")
    for (const model of KNOWN_MODELS) {
      expect(unknown).toBeGreaterThanOrEqual(costMicros(usage, model))
    }
  })

  it("derives each model's figure from the table rather than a copy of it", () => {
    for (const model of KNOWN_MODELS) {
      const { inputMicrosPerToken, outputMicrosPerToken } = MODEL_PRICING[model]
      expect(costMicros({ input_tokens: 1000, output_tokens: 0 }, model)).toBe(
        1000 * inputMicrosPerToken,
      )
      expect(costMicros({ input_tokens: 0, output_tokens: 1000 }, model)).toBe(
        1000 * outputMicrosPerToken,
      )
    }
  })

  it("is zero for empty usage on every model", () => {
    for (const model of KNOWN_MODELS) {
      expect(costMicros({ input_tokens: 0, output_tokens: 0 }, model)).toBe(0)
    }
  })
})
