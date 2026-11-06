import { listUpcomingPlans, normalizePlanDate } from "../upcoming-story-plans"

describe("upcoming story plans", () => {
  it("keeps the calendar day of a local-midnight Date", () => {
    expect(normalizePlanDate(new Date(2026, 10, 7))).toBe("2026-11-07")
    expect(normalizePlanDate("2026-11-07T00:00:00.000Z")).toBe("2026-11-07")
  })

  it("lists plans from today to today + lookahead, both inclusive, oldest first", async () => {
    const plans = [
      { id: "p_before", plan_date: "2026-11-05" },
      { id: "p_end", plan_date: new Date(2026, 10, 13) },
      { id: "p_today", plan_date: "2026-11-06" },
      { id: "p_after", plan_date: "2026-11-14" },
      { id: "p_mid", plan_date: "2026-11-09" },
    ]
    const stories = { listStoryPlans: jest.fn(async () => plans) }
    const got = await listUpcomingPlans(stories as any, 7, "2026-11-06")
    expect(got).toEqual([
      { id: "p_today", plan_date: "2026-11-06" },
      { id: "p_mid", plan_date: "2026-11-09" },
      { id: "p_end", plan_date: "2026-11-13" },
    ])
  })
})
