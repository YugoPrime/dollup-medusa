import {
  addDaysToMauritiusDate,
  mauritiusToday,
  mauritiusTomorrow,
} from "../mauritius-date"

describe("mauritius-date", () => {
  describe("mauritiusToday", () => {
    it("returns the MU local calendar date, not UTC", () => {
      // 2026-05-17 22:30 UTC = 2026-05-18 02:30 MU
      const utc = new Date("2026-05-17T22:30:00Z")
      expect(mauritiusToday(utc)).toBe("2026-05-18")
    })

    it("matches UTC during the daytime window", () => {
      // 2026-05-17 10:00 UTC = 2026-05-17 14:00 MU
      const utc = new Date("2026-05-17T10:00:00Z")
      expect(mauritiusToday(utc)).toBe("2026-05-17")
    })
  })

  describe("mauritiusTomorrow", () => {
    it("returns the day after the MU local date", () => {
      // 2026-05-17 10:00 UTC = 2026-05-17 14:00 MU → tomorrow = 2026-05-18
      const utc = new Date("2026-05-17T10:00:00Z")
      expect(mauritiusTomorrow(utc)).toBe("2026-05-18")
    })

    it("handles month rollover correctly", () => {
      // Jan 31 17:00 UTC = Jan 31 21:00 MU → tomorrow = Feb 1
      const utc = new Date("2026-01-31T17:00:00Z")
      expect(mauritiusTomorrow(utc)).toBe("2026-02-01")
    })

    it("when current MU time is between 20:00-24:00 UTC, tomorrow is the day-after-tomorrow in UTC", () => {
      // 2026-05-17 22:30 UTC = 2026-05-18 02:30 MU (already tomorrow locally)
      // → MU "tomorrow" = 2026-05-19
      const utc = new Date("2026-05-17T22:30:00Z")
      expect(mauritiusTomorrow(utc)).toBe("2026-05-19")
    })
  })

  describe("addDaysToMauritiusDate", () => {
    it("adds positive days", () => {
      expect(addDaysToMauritiusDate("2026-05-17", 5)).toBe("2026-05-22")
    })
    it("crosses month boundaries", () => {
      expect(addDaysToMauritiusDate("2026-01-30", 5)).toBe("2026-02-04")
    })
    it("supports negative days", () => {
      expect(addDaysToMauritiusDate("2026-05-17", -7)).toBe("2026-05-10")
    })
  })
})
