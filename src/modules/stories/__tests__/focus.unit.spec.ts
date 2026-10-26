import {
  activeFocusTag,
  countEligibleFocus,
  hasTag,
  parseFocusSettingsInput,
} from "../focus"

describe("activeFocusTag", () => {
  it("is active through the last day of the window, trimmed and lowercased", () => {
    expect(activeFocusTag({ focus_tag: " Collection30 ", focus_until: "2027-02-28" }, "2027-02-28")).toBe(
      "collection30",
    )
  })

  it("is off the day after focus_until", () => {
    expect(activeFocusTag({ focus_tag: "collection30", focus_until: "2027-02-28" }, "2027-03-01")).toBeNull()
  })

  it("has no end when focus_until is null", () => {
    expect(activeFocusTag({ focus_tag: "collection30", focus_until: null }, "2030-01-01")).toBe("collection30")
  })

  it("is off when the tag is empty", () => {
    expect(activeFocusTag({ focus_tag: "", focus_until: "2027-02-28" }, "2026-11-01")).toBeNull()
  })
})

describe("hasTag", () => {
  it("matches case-insensitively", () => {
    expect(hasTag({ tags: ["Collection30"] }, "collection30")).toBe(true)
  })

  it("is false for a product without tags", () => {
    expect(hasTag({}, "collection30")).toBe(false)
  })
})

describe("countEligibleFocus", () => {
  it("counts tagged products that are in stock", () => {
    expect(
      countEligibleFocus(
        [
          { tags: ["collection30"], variants: [{ inventory_quantity: 2 }] },
          { tags: ["collection30"], variants: [{ inventory_quantity: 0 }] },
          { tags: [], variants: [{ inventory_quantity: 5 }] },
        ],
        "collection30",
      ),
    ).toBe(1)
  })
})

describe("parseFocusSettingsInput", () => {
  it("trims the tag and keeps a valid date", () => {
    expect(parseFocusSettingsInput({ focus_tag: " collection30 ", focus_until: "2027-02-28" })).toEqual({
      focus_tag: "collection30",
      focus_until: "2027-02-28",
    })
  })

  it("turns empty strings into null (focus off)", () => {
    expect(parseFocusSettingsInput({ focus_tag: "", focus_until: "" })).toEqual({
      focus_tag: null,
      focus_until: null,
    })
  })

  it("leaves absent keys out", () => {
    expect(parseFocusSettingsInput({})).toEqual({})
  })

  it("rejects a non-ISO date", () => {
    expect(() => parseFocusSettingsInput({ focus_until: "28/02/2027" })).toThrow(
      "focus_until must be YYYY-MM-DD",
    )
  })

  it("rejects a tag with spaces", () => {
    expect(() => parseFocusSettingsInput({ focus_tag: "new collection" })).toThrow(
      "focus_tag must be letters, digits, - or _",
    )
  })
})

import { wantsFocusStats } from "../focus"

describe("wantsFocusStats", () => {
  it("is opt-in via ?stats=1", () => {
    expect(wantsFocusStats({ stats: "1" })).toBe(true)
    expect(wantsFocusStats({})).toBe(false)
    expect(wantsFocusStats({ stats: "0" })).toBe(false)
  })
})
