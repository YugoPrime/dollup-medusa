import { resolveFillerForDate } from "../stories-filler"

describe("resolveFillerForDate", () => {
  it("returns null when STORIES_FILLER_WEEKDAY is unset (filler disabled by default)", () => {
    expect(resolveFillerForDate("2026-05-25", {})).toBeNull()
    expect(resolveFillerForDate("2026-05-25", { STORIES_FILLER_WEEKDAY: "" })).toBeNull()
  })

  it("returns config when planDate's weekday matches STORIES_FILLER_WEEKDAY", () => {
    // 2026-05-25 is a Monday (weekday=1)
    const r = resolveFillerForDate("2026-05-25", {
      STORIES_FILLER_WEEKDAY: "1",
    })
    expect(r).not.toBeNull()
    expect(r!.templateSlug).toBe("how-to-order")
    expect(r!.scheduledTime).toBe("10:00")
  })

  it("returns null when planDate's weekday does not match", () => {
    // 2026-05-26 is a Tuesday; weekday env says Monday
    expect(
      resolveFillerForDate("2026-05-26", { STORIES_FILLER_WEEKDAY: "1" }),
    ).toBeNull()
  })

  it("respects custom STORIES_FILLER_TEMPLATE override", () => {
    const r = resolveFillerForDate("2026-05-25", {
      STORIES_FILLER_WEEKDAY: "1",
      STORIES_FILLER_TEMPLATE: "customer-review",
    })
    expect(r!.templateSlug).toBe("customer-review")
  })

  it("respects custom STORIES_FILLER_TIME override and validates HH:mm shape", () => {
    expect(
      resolveFillerForDate("2026-05-25", {
        STORIES_FILLER_WEEKDAY: "1",
        STORIES_FILLER_TIME: "20:30",
      })!.scheduledTime,
    ).toBe("20:30")
  })

  it("ignores an invalid STORIES_FILLER_TIME and falls back to 10:00", () => {
    expect(
      resolveFillerForDate("2026-05-25", {
        STORIES_FILLER_WEEKDAY: "1",
        STORIES_FILLER_TIME: "not-a-time",
      })!.scheduledTime,
    ).toBe("10:00")
  })

  it("returns null when STORIES_FILLER_WEEKDAY is out of 0..6 range", () => {
    expect(
      resolveFillerForDate("2026-05-25", { STORIES_FILLER_WEEKDAY: "9" }),
    ).toBeNull()
    expect(
      resolveFillerForDate("2026-05-25", { STORIES_FILLER_WEEKDAY: "-1" }),
    ).toBeNull()
    expect(
      resolveFillerForDate("2026-05-25", { STORIES_FILLER_WEEKDAY: "monday" }),
    ).toBeNull()
  })

  it("treats Sunday as weekday 0", () => {
    // 2026-05-24 is a Sunday
    expect(
      resolveFillerForDate("2026-05-24", { STORIES_FILLER_WEEKDAY: "0" }),
    ).not.toBeNull()
    expect(
      resolveFillerForDate("2026-05-24", { STORIES_FILLER_WEEKDAY: "1" }),
    ).toBeNull()
  })

  it("returns null on a malformed plan date rather than throwing", () => {
    expect(
      resolveFillerForDate("not-a-date", { STORIES_FILLER_WEEKDAY: "1" }),
    ).toBeNull()
    expect(
      resolveFillerForDate("", { STORIES_FILLER_WEEKDAY: "1" }),
    ).toBeNull()
  })
})
