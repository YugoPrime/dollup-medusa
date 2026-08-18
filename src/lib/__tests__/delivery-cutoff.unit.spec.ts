import {
  CUTOFF_CHOICES,
  DEFAULT_CUTOFF_HOUR,
  buildCallbackData,
  buildCutoffConfirmation,
  buildCutoffPrompt,
  buildEtaCopy,
  buildEtaCopyFr,
  formatCutoffEn,
  formatCutoffFr,
  isCutoffChoice,
  muDay,
  muWeekday,
  normalizeCutoffHour,
  parseCallbackData,
} from "../delivery-cutoff"

// 2026-08-14 is a Friday. 08:00 UTC = 12:00 Mauritius.
const FRIDAY = new Date("2026-08-14T05:00:00.000Z")
const WEDNESDAY = new Date("2026-08-12T05:00:00.000Z")

describe("normalizeCutoffHour", () => {
  it("keeps every offerable choice", () => {
    for (const h of CUTOFF_CHOICES) {
      expect(normalizeCutoffHour(h)).toBe(h)
    }
  })

  // The read path guards the delivery promise: an out-of-range value must
  // narrow to the default, never widen past what the courier can meet.
  it("falls back to the default rather than trusting a bad value", () => {
    for (const bad of [11, 16, 23, 0, -1, 12.9, "abc", null, undefined, Number.NaN, {}]) {
      expect(normalizeCutoffHour(bad)).toBe(DEFAULT_CUTOFF_HOUR)
    }
  })

  it("defaults to noon", () => {
    expect(DEFAULT_CUTOFF_HOUR).toBe(12)
  })
})

describe("isCutoffChoice", () => {
  it("accepts only the four offerable hours", () => {
    expect(isCutoffChoice(12)).toBe(true)
    expect(isCutoffChoice(15)).toBe(true)
    expect(isCutoffChoice(11)).toBe(false)
    expect(isCutoffChoice("12")).toBe(false)
  })
})

describe("formatting", () => {
  it("writes noon as a word and later hours in 12-hour form", () => {
    expect(formatCutoffEn(12)).toBe("noon")
    expect(formatCutoffEn(13)).toBe("1pm")
    expect(formatCutoffEn(14)).toBe("2pm")
    expect(formatCutoffEn(15)).toBe("3pm")
  })

  it("writes the French form the concierge uses", () => {
    expect(formatCutoffFr(12)).toBe("midi")
    expect(formatCutoffFr(13)).toBe("13h")
  })

  it("normalizes before formatting so a bad value can never be printed", () => {
    expect(formatCutoffEn(99)).toBe("noon")
    expect(formatCutoffFr(99)).toBe("midi")
  })
})

describe("buildEtaCopy", () => {
  it("generates the customer sentence from the stored hour", () => {
    expect(buildEtaCopy(12)).toBe(
      "Order before noon for next-day delivery across Mauritius.",
    )
    expect(buildEtaCopy(14)).toBe(
      "Order before 2pm for next-day delivery across Mauritius.",
    )
  })

  it("states the Friday-to-Monday rule in the French copy", () => {
    const fr = buildEtaCopyFr(12)
    expect(fr).toContain("avant midi")
    expect(fr).toContain("vendredi")
    expect(fr).toContain("lundi")
    expect(fr).toContain("dimanche")
  })
})

describe("callback payloads", () => {
  it("round-trips every offerable hour", () => {
    for (const h of CUTOFF_CHOICES) {
      expect(parseCallbackData(buildCallbackData(h))).toBe(h)
    }
  })

  // Telegram delivers callbacks from any keyboard, and an old message's button
  // can be tapped days later — anything unrecognized must be ignored, not coerced.
  it("rejects foreign, malformed and out-of-range payloads", () => {
    for (const bad of [
      "",
      "cutoff:",
      "cutoff:11",
      "cutoff:99",
      "cutoff:abc",
      "other:12",
      "12",
      null,
      undefined,
      12,
      {},
    ]) {
      expect(parseCallbackData(bad)).toBeNull()
    }
  })
})

describe("Mauritius date helpers", () => {
  it("shifts UTC into Mauritius before taking the day", () => {
    // 21:00 UTC is already the next day in Mauritius (+4).
    expect(muDay(new Date("2026-08-13T21:00:00.000Z"))).toBe("2026-08-14")
    expect(muDay(new Date("2026-08-13T19:00:00.000Z"))).toBe("2026-08-13")
  })

  it("reads Friday as weekday 5", () => {
    expect(muWeekday(FRIDAY)).toBe(5)
    expect(muWeekday(WEDNESDAY)).toBe(3)
  })

  it("rolls the weekday over with the Mauritius day, not the UTC one", () => {
    // Friday 21:00 UTC is Saturday 01:00 in Mauritius.
    expect(muWeekday(new Date("2026-08-14T21:00:00.000Z"))).toBe(6)
  })
})

describe("buildCutoffPrompt", () => {
  it("offers one button per choice, each carrying a parseable payload", () => {
    const p = buildCutoffPrompt(WEDNESDAY)
    expect(p.buttons).toHaveLength(CUTOFF_CHOICES.length)
    for (const b of p.buttons) {
      expect(parseCallbackData(b.callback_data)).not.toBeNull()
    }
    expect(p.buttons.map((b) => b.text)).toEqual([
      "Keep noon",
      "Push to 1pm",
      "Push to 2pm",
      "Push to 3pm",
    ])
  })

  // Silence has to be a real choice, so the message says what happens anyway.
  it("states that it closes at noon unless pushed", () => {
    const text = buildCutoffPrompt(WEDNESDAY).text
    expect(text).toContain("noon")
    expect(text).toContain("unless you push it")
  })

  it("warns about the weekend only on Friday", () => {
    expect(buildCutoffPrompt(FRIDAY).text).toContain("Monday")
    expect(buildCutoffPrompt(WEDNESDAY).text).not.toContain("Monday")
  })
})

describe("buildCutoffConfirmation", () => {
  it("reads as closing when the default is kept", () => {
    expect(buildCutoffConfirmation(12, WEDNESDAY)).toBe("Closed at noon.")
  })

  it("reads as an extension when pushed later", () => {
    expect(buildCutoffConfirmation(13, WEDNESDAY)).toBe("Cutoff pushed to 1pm.")
  })

  it("spells out the Monday consequence on a Friday", () => {
    expect(buildCutoffConfirmation(13, FRIDAY)).toContain("Monday")
    expect(buildCutoffConfirmation(12, FRIDAY)).toContain("Monday")
  })
})
