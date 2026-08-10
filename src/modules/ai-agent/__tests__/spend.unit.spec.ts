import { computeSpendUpdate, currentPeriod } from "../lib/spend"

const BUDGET = 22_000_000 // $22 in micro-dollars

function settings(over: Partial<Parameters<typeof computeSpendUpdate>[0]["settings"]> = {}) {
  return {
    monthly_budget_usd_micros: BUDGET,
    spend_usd_micros: 0,
    spend_period: "2026-08",
    budget_alert_sent_at: null,
    ...over,
  }
}

const NOW = new Date("2026-08-10T12:00:00Z")

describe("currentPeriod", () => {
  it("is the UTC year-month", () => {
    expect(currentPeriod(new Date("2026-08-10T23:59:00Z"))).toBe("2026-08")
    expect(currentPeriod(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01")
  })

  it("rolls at the UTC month boundary, not local time", () => {
    expect(currentPeriod(new Date("2026-08-31T23:59:59Z"))).toBe("2026-08")
    expect(currentPeriod(new Date("2026-09-01T00:00:00Z"))).toBe("2026-09")
  })
})

describe("computeSpendUpdate", () => {
  it("adds to the running total", () => {
    const out = computeSpendUpdate({ settings: settings(), micros: 1_000_000, now: NOW })
    expect(out.spend_usd_micros).toBe(1_000_000)
    expect(out.rolled).toBe(false)
    expect(out.crossed70).toBe(false)
    expect(out.exhausted).toBe(false)
  })

  it("reports crossing 70% exactly once", () => {
    // 70% of 22M is 15.4M
    const first = computeSpendUpdate({
      settings: settings({ spend_usd_micros: 15_000_000 }),
      micros: 500_000,
      now: NOW,
    })
    expect(first.spend_usd_micros).toBe(15_500_000)
    expect(first.crossed70).toBe(true)

    // Once the alert has been sent, later runs must not re-report it
    const second = computeSpendUpdate({
      settings: settings({
        spend_usd_micros: 15_500_000,
        budget_alert_sent_at: new Date("2026-08-10T11:00:00Z"),
      }),
      micros: 100_000,
      now: NOW,
    })
    expect(second.crossed70).toBe(false)
  })

  it("does not report 70% when the threshold was already passed before this run", () => {
    const out = computeSpendUpdate({
      settings: settings({ spend_usd_micros: 20_000_000 }),
      micros: 100_000,
      now: NOW,
    })
    expect(out.crossed70).toBe(false)
  })

  it("reports exhausted at exactly the ceiling", () => {
    const out = computeSpendUpdate({ settings: settings(), micros: BUDGET, now: NOW })
    expect(out.exhausted).toBe(true)
  })

  it("reports exhausted above the ceiling", () => {
    const out = computeSpendUpdate({
      settings: settings({ spend_usd_micros: BUDGET }),
      micros: 1,
      now: NOW,
    })
    expect(out.exhausted).toBe(true)
  })

  it("is not exhausted one micro-dollar below the ceiling", () => {
    const out = computeSpendUpdate({
      settings: settings({ spend_usd_micros: BUDGET - 2 }),
      micros: 1,
      now: NOW,
    })
    expect(out.exhausted).toBe(false)
  })

  it("resets the total and the alert flag when the period rolls over", () => {
    const out = computeSpendUpdate({
      settings: settings({
        spend_usd_micros: 20_000_000,
        spend_period: "2026-07",
        budget_alert_sent_at: new Date("2026-07-20T00:00:00Z"),
      }),
      micros: 1_000_000,
      now: NOW,
    })
    expect(out.rolled).toBe(true)
    expect(out.spend_usd_micros).toBe(1_000_000)
    expect(out.spend_period).toBe("2026-08")
    expect(out.clearAlert).toBe(true)
    expect(out.crossed70).toBe(false)
  })

  it("a rollover run that itself crosses 70% still reports it", () => {
    const out = computeSpendUpdate({
      settings: settings({
        spend_usd_micros: 21_000_000,
        spend_period: "2026-07",
        budget_alert_sent_at: new Date("2026-07-20T00:00:00Z"),
      }),
      micros: 16_000_000,
      now: NOW,
    })
    expect(out.rolled).toBe(true)
    expect(out.spend_usd_micros).toBe(16_000_000)
    expect(out.crossed70).toBe(true)
  })

  it("never records a negative amount", () => {
    const out = computeSpendUpdate({ settings: settings(), micros: -5_000, now: NOW })
    expect(out.spend_usd_micros).toBe(0)
  })

  it("rounds a fractional amount to a whole micro-dollar", () => {
    const out = computeSpendUpdate({ settings: settings(), micros: 1234.7, now: NOW })
    expect(Number.isInteger(out.spend_usd_micros)).toBe(true)
    expect(out.spend_usd_micros).toBe(1235)
  })

  it("treats a corrupt stored total as zero rather than blocking spend forever", () => {
    const out = computeSpendUpdate({
      settings: settings({ spend_usd_micros: Number.NaN }),
      micros: 1_000,
      now: NOW,
    })
    expect(out.spend_usd_micros).toBe(1_000)
  })

  it("is exhausted at a zero budget with zero spend — spend nothing means nothing", () => {
    const out = computeSpendUpdate({
      settings: settings({ monthly_budget_usd_micros: 0 }),
      micros: 0,
      now: NOW,
    })
    expect(out.exhausted).toBe(true)
  })

  it("is exhausted at a zero budget with some spend", () => {
    const out = computeSpendUpdate({
      settings: settings({ monthly_budget_usd_micros: 0 }),
      micros: 500,
      now: NOW,
    })
    expect(out.exhausted).toBe(true)
  })

  it("is exhausted at a negative budget", () => {
    const out = computeSpendUpdate({
      settings: settings({ monthly_budget_usd_micros: -1 }),
      micros: 0,
      now: NOW,
    })
    expect(out.exhausted).toBe(true)
  })

  it("is exhausted at a NaN budget (coerced to 0 by the `|| 0` fallback)", () => {
    const out = computeSpendUpdate({
      settings: settings({ monthly_budget_usd_micros: Number.NaN }),
      micros: 0,
      now: NOW,
    })
    expect(out.exhausted).toBe(true)
  })
})
