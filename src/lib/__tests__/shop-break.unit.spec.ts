import {
  shopBreakActive,
  shopBreakResumesLabel,
  shopBreakResumesOn,
} from "../shop-break"

// MU is UTC+4, so a MU calendar day starts at 20:00 UTC the day before.
const duringBreak = new Date("2026-09-21T06:00:00Z")
const lastMuMinute = new Date("2026-10-16T19:59:00Z") // 23:59 MU on 16 Oct
const firstMuMinute = new Date("2026-10-16T20:00:00Z") // 00:00 MU on 17 Oct

describe("shopBreakActive", () => {
  it("is on during the break and turns itself off at MU midnight", () => {
    expect(shopBreakActive(duringBreak, {})).toBe(true)
    expect(shopBreakActive(lastMuMinute, {})).toBe(true)
    expect(shopBreakActive(firstMuMinute, {})).toBe(false)
  })

  it("can be ended early with SHOP_BREAK_RESUMES_ON", () => {
    expect(
      shopBreakActive(duringBreak, { SHOP_BREAK_RESUMES_ON: "2026-09-20" }),
    ).toBe(false)
  })

  it("ignores a malformed override rather than disabling the notice", () => {
    for (const bad of ["17/10/2026", "soon", ""]) {
      expect(shopBreakResumesOn({ SHOP_BREAK_RESUMES_ON: bad })).toBe("2026-10-17")
    }
  })
})

describe("shopBreakResumesLabel", () => {
  it("writes the date the way customers read it", () => {
    expect(shopBreakResumesLabel({})).toBe("17/10")
    expect(shopBreakResumesLabel({ SHOP_BREAK_RESUMES_ON: "2026-11-03" })).toBe("03/11")
  })
})
