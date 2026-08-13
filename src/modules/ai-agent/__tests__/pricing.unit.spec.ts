import {
  AGENT_MODEL,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  DEFAULT_MODEL,
  KNOWN_MODELS,
  MODEL_PRICING,
  assessCaching,
  isKnownModel,
  priceFor,
} from "../lib/pricing"

describe("MODEL_PRICING", () => {
  it("prices Sonnet 5 at list ($3/$15), not the introductory rate", () => {
    expect(MODEL_PRICING["claude-sonnet-5"].inputMicrosPerToken).toBe(3)
    expect(MODEL_PRICING["claude-sonnet-5"].outputMicrosPerToken).toBe(15)
  })

  it("prices Haiku 4.5 at exactly one third of Sonnet 5", () => {
    const haiku = MODEL_PRICING["claude-haiku-4-5"]
    const sonnet = MODEL_PRICING["claude-sonnet-5"]
    expect(haiku.inputMicrosPerToken * 3).toBe(sonnet.inputMicrosPerToken)
    expect(haiku.outputMicrosPerToken * 3).toBe(sonnet.outputMicrosPerToken)
  })

  it("keeps output dearer than input for every model", () => {
    for (const model of KNOWN_MODELS) {
      const p = MODEL_PRICING[model]
      expect(p.outputMicrosPerToken).toBeGreaterThan(p.inputMicrosPerToken)
    }
  })

  it("gives every model a positive cache minimum", () => {
    for (const model of KNOWN_MODELS) {
      expect(MODEL_PRICING[model].cacheMinimumTokens).toBeGreaterThan(0)
    }
  })

  // The trap this table exists to make visible: the cheaper model is harder to
  // cache on, so cache minimums do not track price.
  it("requires a longer prefix on Haiku 4.5 than on the pricier Sonnet 5", () => {
    expect(MODEL_PRICING["claude-haiku-4-5"].cacheMinimumTokens).toBeGreaterThan(
      MODEL_PRICING["claude-sonnet-5"].cacheMinimumTokens,
    )
  })

  it("defaults to a model that is actually in the table", () => {
    expect(isKnownModel(DEFAULT_MODEL)).toBe(true)
  })
})

describe("isKnownModel", () => {
  it("accepts exact model IDs and rejects aliases or typos", () => {
    expect(isKnownModel("claude-sonnet-5")).toBe(true)
    expect(isKnownModel("claude-haiku-4-5")).toBe(true)
    expect(isKnownModel("claude-sonnet-5-20260101")).toBe(false)
    expect(isKnownModel("sonnet")).toBe(false)
    expect(isKnownModel("")).toBe(false)
  })

  it("is not fooled by inherited Object properties", () => {
    expect(isKnownModel("toString")).toBe(false)
    expect(isKnownModel("constructor")).toBe(false)
  })
})

describe("priceFor", () => {
  it("returns the exact rates for a known model", () => {
    expect(priceFor("claude-haiku-4-5").inputMicrosPerToken).toBe(1)
  })

  // Over-billing trips the budget early and hands off to a human — the designed
  // degraded state. Under-billing would let real spend run past the ceiling.
  it("bills an unknown model at the most expensive known rate, never the default", () => {
    const unknown = priceFor("claude-something-new")
    const dearest = Math.max(...KNOWN_MODELS.map((m) => MODEL_PRICING[m].outputMicrosPerToken))
    expect(unknown.outputMicrosPerToken).toBe(dearest)
    expect(unknown.outputMicrosPerToken).toBeGreaterThan(
      MODEL_PRICING[DEFAULT_MODEL].outputMicrosPerToken,
    )
  })

  it("does not throw on an unknown model", () => {
    expect(() => priceFor("nonsense")).not.toThrow()
  })
})

describe("cache multipliers", () => {
  it("makes a cache read an order of magnitude cheaper than fresh input", () => {
    expect(CACHE_READ_MULTIPLIER).toBe(0.1)
  })

  // 1.25x is the 5-minute TTL rate, which is what buildSystemBlocks() requests.
  // A 1-hour TTL would be 2x.
  it("charges a premium on the cache write", () => {
    expect(CACHE_WRITE_MULTIPLIER).toBeGreaterThan(1)
  })
})

describe("assessCaching", () => {
  it("reports caching when the prefix clears the model's minimum", () => {
    const a = assessCaching("claude-sonnet-5", 5000)
    expect(a.caches).toBe(true)
    expect(a.shortfallTokens).toBe(0)
  })

  it("reports the shortfall when the prefix is too short", () => {
    const a = assessCaching("claude-haiku-4-5", 3000)
    expect(a.caches).toBe(false)
    expect(a.cacheMinimumTokens).toBe(4096)
    expect(a.shortfallTokens).toBe(1096)
  })

  // The exact scenario that would silently eat a model switch: identical prefix,
  // caches on the pricier model, does not cache on the cheaper one.
  it("catches a prefix that caches on Sonnet 5 but not on Haiku 4.5", () => {
    const prefix = 2000
    expect(assessCaching("claude-sonnet-5", prefix).caches).toBe(true)
    expect(assessCaching("claude-haiku-4-5", prefix).caches).toBe(false)
  })

  it("treats a boundary prefix as caching", () => {
    expect(assessCaching("claude-haiku-4-5", 4096).caches).toBe(true)
    expect(assessCaching("claude-haiku-4-5", 4095).caches).toBe(false)
  })

  it("handles a zero or nonsense prefix without throwing", () => {
    expect(assessCaching("claude-sonnet-5", 0).caches).toBe(false)
    expect(assessCaching("claude-sonnet-5", Number.NaN).prefixTokens).toBe(0)
    expect(assessCaching("claude-sonnet-5", -100).prefixTokens).toBe(0)
  })
})

describe("AGENT_MODEL", () => {
  it("resolves to a string the pricing table can price", () => {
    expect(typeof AGENT_MODEL).toBe("string")
    expect(priceFor(AGENT_MODEL).inputMicrosPerToken).toBeGreaterThan(0)
  })
})
