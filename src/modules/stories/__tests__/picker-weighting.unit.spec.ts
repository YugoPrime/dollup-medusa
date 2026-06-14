import {
  DEFAULT_WEIGHTING,
  isWithinBoostWindow,
  pickWeightedProduct,
  productWeight,
  weightedPickIndex,
  type WeightingConfig,
} from "../picker-weighting"

const NOW = Date.parse("2026-06-14T12:00:00Z")
const DAY = 24 * 60 * 60 * 1000

const cfg: WeightingConfig = { collection_boost: 3, collection_boost_days: 14 }

const at = (msAgo: number) => ({ created_at: new Date(NOW - msAgo).toISOString() })

describe("isWithinBoostWindow", () => {
  it("treats products created inside the window as current", () => {
    expect(isWithinBoostWindow(at(2 * DAY), 14, NOW)).toBe(true)
    expect(isWithinBoostWindow(at(14 * DAY - 1), 14, NOW)).toBe(true)
  })
  it("treats products created outside the window as back-catalog", () => {
    expect(isWithinBoostWindow(at(20 * DAY), 14, NOW)).toBe(false)
  })
  it("returns false when created_at is missing or unparseable", () => {
    expect(isWithinBoostWindow({ created_at: undefined }, 14, NOW)).toBe(false)
    expect(isWithinBoostWindow({ created_at: "not-a-date" }, 14, NOW)).toBe(false)
  })
})

describe("productWeight", () => {
  it("boosts recent products and leaves older ones at 1", () => {
    expect(productWeight(at(1 * DAY), cfg, NOW)).toBe(3)
    expect(productWeight(at(30 * DAY), cfg, NOW)).toBe(1)
  })
  it("collapses to uniform when boost <= 1", () => {
    const noBoost: WeightingConfig = { collection_boost: 1, collection_boost_days: 14 }
    expect(productWeight(at(1 * DAY), noBoost, NOW)).toBe(1)
  })
  it("never goes below 1 even with a bad boost value", () => {
    const bad: WeightingConfig = { collection_boost: 0, collection_boost_days: 14 }
    expect(productWeight(at(1 * DAY), bad, NOW)).toBe(1)
  })
})

describe("weightedPickIndex", () => {
  it("maps rng across the cumulative weight ranges", () => {
    // weights [3, 1] -> total 4. r in [0,3) -> idx 0, [3,4) -> idx 1.
    expect(weightedPickIndex([3, 1], () => 0)).toBe(0)
    expect(weightedPickIndex([3, 1], () => 0.74)).toBe(0) // 0.74*4=2.96 < 3
    expect(weightedPickIndex([3, 1], () => 0.8)).toBe(1) // 0.8*4=3.2 >= 3
  })
  it("returns -1 for an empty array", () => {
    expect(weightedPickIndex([], Math.random)).toBe(-1)
  })
  it("falls back to uniform when every weight is zero", () => {
    expect(weightedPickIndex([0, 0], () => 0.6)).toBe(1)
  })
})

describe("pickWeightedProduct", () => {
  const NEW = { id: "new", created_at: new Date(NOW - DAY).toISOString() }
  const OLD = { id: "old", created_at: new Date(NOW - 60 * DAY).toISOString() }

  it("returns null for an empty pool", () => {
    expect(pickWeightedProduct([], cfg, NOW)).toBeNull()
  })

  it("can still pick the back-catalog product (never excludes it)", () => {
    // rng forced high -> lands in the OLD product's slice.
    expect(pickWeightedProduct([NEW, OLD], cfg, NOW, () => 0.99)?.id).toBe("old")
  })

  it("biases toward the current collection over many draws", () => {
    let seed = 0.123456789
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280 / 233280
      return seed
    }
    let newCount = 0
    const draws = 4000
    for (let i = 0; i < draws; i++) {
      if (pickWeightedProduct([NEW, OLD], cfg, NOW, rng)?.id === "new") newCount++
    }
    // Expected ~3/4 with boost 3. Assert a comfortable margin above 1/2.
    expect(newCount / draws).toBeGreaterThan(0.65)
  })

  it("exposes sane defaults", () => {
    expect(DEFAULT_WEIGHTING.collection_boost).toBeGreaterThan(1)
    expect(DEFAULT_WEIGHTING.collection_boost_days).toBeGreaterThan(0)
  })
})
