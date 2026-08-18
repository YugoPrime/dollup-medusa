import {
  buildEmailHealthAlert,
  canaryIsBroken,
  classifyEmailHealth,
  summarizeNotificationHealth,
  type CanaryOutcome,
  type NotificationRow,
} from "../notification-health"

const delivered = (to = "a@gmail.com"): NotificationRow => ({
  to,
  template: "order-placed",
  status: "success",
  external_id: "re_abc123",
})

const failed = (to = "b@gmail.com", template = "order-shipped"): NotificationRow => ({
  to,
  template,
  status: "failure",
  external_id: null,
})

// success + no external_id on a real address = Resend never took it.
const phantom = (to = "c@gmail.com"): NotificationRow => ({
  to,
  template: "welcome",
  status: "success",
  external_id: null,
})

// The provider skips placeholder addresses on purpose.
const skipped = (): NotificationRow => ({
  to: "dm-57661612@dollupboutique.local",
  template: "order-placed",
  status: "success",
  external_id: null,
})

const CANARY_OK: CanaryOutcome = { status: "ok", externalId: "re_canary" }
const CANARY_THREW: CanaryOutcome = {
  status: "threw",
  message: "Could not find a notification provider for channel: email",
}
const CANARY_NOT_SENT: CanaryOutcome = { status: "not_sent" }
const CANARY_SKIPPED: CanaryOutcome = { status: "skipped" }

describe("summarizeNotificationHealth", () => {
  it("counts an empty window as entirely healthy", () => {
    const h = summarizeNotificationHealth([])
    expect(h.total).toBe(0)
    expect(h.failed).toBe(0)
    expect(classifyEmailHealth(h, CANARY_OK)).toBe("ok")
  })

  it("does not treat skipped placeholder addresses as broken", () => {
    const h = summarizeNotificationHealth([skipped(), skipped(), delivered()])
    expect(h.skipped).toBe(2)
    expect(h.delivered).toBe(1)
    expect(h.phantom).toBe(0)
    expect(h.failed).toBe(0)
    expect(h.affectedRecipients).toEqual([])
    expect(classifyEmailHealth(h, CANARY_OK)).toBe("ok")
  })

  it("flags a success with no external_id on a real address as phantom", () => {
    const h = summarizeNotificationHealth([phantom()])
    expect(h.phantom).toBe(1)
    expect(h.delivered).toBe(0)
    expect(h.affectedRecipients).toEqual(["c@gmail.com"])
  })

  it("counts pending rows separately from failures", () => {
    const h = summarizeNotificationHealth([
      { to: "d@gmail.com", template: "welcome", status: "pending", external_id: null },
    ])
    expect(h.pending).toBe(1)
    expect(h.failed).toBe(0)
    expect(h.phantom).toBe(0)
  })

  it("groups broken notifications by template and dedupes recipients", () => {
    const h = summarizeNotificationHealth([
      failed("x@gmail.com", "order-shipped"),
      failed("x@gmail.com", "order-shipped"),
      failed("y@gmail.com", "welcome"),
      delivered("z@gmail.com"),
    ])
    expect(h.brokenByTemplate).toEqual({ "order-shipped": 2, welcome: 1 })
    expect(h.affectedRecipients).toEqual(["x@gmail.com", "y@gmail.com"])
  })

  it("treats addresses case-insensitively when counting affected customers", () => {
    const h = summarizeNotificationHealth([
      failed("Parvesh@Gmail.com"),
      failed("parvesh@gmail.com"),
    ])
    expect(h.affectedRecipients).toEqual(["parvesh@gmail.com"])
  })
})

describe("canaryIsBroken", () => {
  it("treats only threw and not_sent as broken", () => {
    expect(canaryIsBroken(CANARY_OK)).toBe(false)
    expect(canaryIsBroken(CANARY_SKIPPED)).toBe(false)
    expect(canaryIsBroken(CANARY_THREW)).toBe(true)
    expect(canaryIsBroken(CANARY_NOT_SENT)).toBe(true)
  })
})

describe("classifyEmailHealth", () => {
  it("reports an outage when nothing at all got delivered", () => {
    const h = summarizeNotificationHealth([failed(), failed(), skipped()])
    expect(classifyEmailHealth(h, CANARY_SKIPPED)).toBe("outage")
  })

  it("reports degraded when some got through and some did not", () => {
    const h = summarizeNotificationHealth([delivered(), failed()])
    expect(classifyEmailHealth(h, CANARY_OK)).toBe("degraded")
  })

  it("counts phantoms alone as enough to break the ok verdict", () => {
    const h = summarizeNotificationHealth([delivered(), phantom()])
    expect(classifyEmailHealth(h, CANARY_OK)).toBe("degraded")
  })

  // The whole reason the canary exists: a quiet day hides a dead pipe.
  it("calls an outage on a broken canary even with an empty window", () => {
    const h = summarizeNotificationHealth([])
    expect(classifyEmailHealth(h, CANARY_THREW)).toBe("outage")
    expect(classifyEmailHealth(h, CANARY_NOT_SENT)).toBe("outage")
  })

  it("escalates to outage on a broken canary even when the sweep looks fine", () => {
    const h = summarizeNotificationHealth([delivered(), delivered()])
    expect(classifyEmailHealth(h, CANARY_NOT_SENT)).toBe("outage")
  })

  it("defaults to the sweep when no canary is supplied", () => {
    expect(classifyEmailHealth(summarizeNotificationHealth([delivered()]))).toBe("ok")
    expect(classifyEmailHealth(summarizeNotificationHealth([failed()]))).toBe("outage")
  })
})

describe("buildEmailHealthAlert", () => {
  it("stays silent when healthy", () => {
    const health = summarizeNotificationHealth([delivered()])
    expect(
      buildEmailHealthAlert({ health, verdict: "ok", windowHours: 24, canary: CANARY_OK }),
    ).toBeNull()
  })

  it("leads with the canary failure and its error text", () => {
    const health = summarizeNotificationHealth([])
    const msg = buildEmailHealthAlert({
      health,
      verdict: "outage",
      windowHours: 24,
      canary: CANARY_THREW,
    })!
    expect(msg).toContain("Live test send just failed")
    expect(msg).toContain("Could not find a notification provider")
    expect(msg).toContain("No notifications in the last 24h to corroborate")
  })

  it("says the pipe is up when the canary passed but rows still broke", () => {
    const health = summarizeNotificationHealth([delivered(), failed()])
    const msg = buildEmailHealthAlert({
      health,
      verdict: "degraded",
      windowHours: 24,
      canary: CANARY_OK,
    })!
    expect(msg).toContain("Live test send worked")
    expect(msg).toContain("did not reach Resend")
  })

  it("includes the restart remedy only on a full outage", () => {
    const out = summarizeNotificationHealth([failed(), failed()])
    const outage = buildEmailHealthAlert({
      health: out,
      verdict: "outage",
      windowHours: 24,
      canary: CANARY_SKIPPED,
    })!
    expect(outage).toContain("CUSTOMER EMAIL IS DOWN")
    expect(outage).toContain("restart the dollup-medusa container")

    const deg = summarizeNotificationHealth([delivered(), failed()])
    const degraded = buildEmailHealthAlert({
      health: deg,
      verdict: "degraded",
      windowHours: 24,
      canary: CANARY_OK,
    })!
    expect(degraded).toContain("Customer emails are failing")
    expect(degraded).not.toContain("restart the dollup-medusa container")
  })

  it("names affected customers and truncates past five", () => {
    const rows = Array.from({ length: 7 }, (_, i) => failed(`c${i}@gmail.com`))
    const health = summarizeNotificationHealth(rows)
    const msg = buildEmailHealthAlert({
      health,
      verdict: "outage",
      windowHours: 24,
      canary: CANARY_SKIPPED,
    })!
    expect(msg).toContain("<b>7</b> real customers affected")
    expect(msg).toContain("c0@gmail.com")
    expect(msg).toContain("and 2 more")
    expect(msg).not.toContain("c6@gmail.com")
  })

  it("escapes HTML so a hostile template name cannot break the message", () => {
    const health = summarizeNotificationHealth([failed("a@gmail.com", "<b>evil</b>")])
    const msg = buildEmailHealthAlert({
      health,
      verdict: "outage",
      windowHours: 24,
      canary: CANARY_SKIPPED,
    })!
    expect(msg).toContain("&lt;b&gt;evil&lt;/b&gt;")
    expect(msg).not.toContain("<b>evil</b>")
  })
})
