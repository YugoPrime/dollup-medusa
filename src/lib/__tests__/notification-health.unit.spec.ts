import {
  buildNotificationHealthAlert,
  classifyNotificationHealth,
  summarizeNotificationHealth,
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

describe("summarizeNotificationHealth", () => {
  it("counts an empty window as entirely healthy", () => {
    const h = summarizeNotificationHealth([])
    expect(h.total).toBe(0)
    expect(h.failed).toBe(0)
    expect(classifyNotificationHealth(h)).toBe("ok")
  })

  it("does not treat skipped placeholder addresses as broken", () => {
    const h = summarizeNotificationHealth([skipped(), skipped(), delivered()])
    expect(h.skipped).toBe(2)
    expect(h.delivered).toBe(1)
    expect(h.phantom).toBe(0)
    expect(h.failed).toBe(0)
    expect(h.affectedRecipients).toEqual([])
    expect(classifyNotificationHealth(h)).toBe("ok")
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

describe("classifyNotificationHealth", () => {
  it("reports an outage when nothing at all got delivered", () => {
    const h = summarizeNotificationHealth([failed(), failed(), skipped()])
    expect(classifyNotificationHealth(h)).toBe("outage")
  })

  it("reports degraded when some got through and some did not", () => {
    const h = summarizeNotificationHealth([delivered(), failed()])
    expect(classifyNotificationHealth(h)).toBe("degraded")
  })

  it("counts phantoms alone as enough to break the ok verdict", () => {
    const h = summarizeNotificationHealth([delivered(), phantom()])
    expect(classifyNotificationHealth(h)).toBe("degraded")
  })
})

describe("buildNotificationHealthAlert", () => {
  it("stays silent when healthy", () => {
    const h = summarizeNotificationHealth([delivered()])
    expect(buildNotificationHealthAlert(h, "ok", 24)).toBeNull()
  })

  it("includes the restart remedy only on a full outage", () => {
    const out = summarizeNotificationHealth([failed(), failed()])
    const outage = buildNotificationHealthAlert(out, "outage", 24)!
    expect(outage).toContain("CUSTOMER EMAIL IS DOWN")
    expect(outage).toContain("restart the dollup-medusa container")

    const deg = summarizeNotificationHealth([delivered(), failed()])
    const degraded = buildNotificationHealthAlert(deg, "degraded", 24)!
    expect(degraded).toContain("Customer emails are failing")
    expect(degraded).not.toContain("restart the dollup-medusa container")
  })

  it("names affected customers and truncates past five", () => {
    const rows = Array.from({ length: 7 }, (_, i) => failed(`c${i}@gmail.com`))
    const h = summarizeNotificationHealth(rows)
    const msg = buildNotificationHealthAlert(h, "outage", 24)!
    expect(msg).toContain("<b>7</b> real customers affected")
    expect(msg).toContain("c0@gmail.com")
    expect(msg).toContain("and 2 more")
    expect(msg).not.toContain("c6@gmail.com")
  })

  it("escapes HTML so a hostile template name cannot break the message", () => {
    const h = summarizeNotificationHealth([
      failed("a@gmail.com", "<b>evil</b>"),
    ])
    const msg = buildNotificationHealthAlert(h, "outage", 24)!
    expect(msg).toContain("&lt;b&gt;evil&lt;/b&gt;")
    expect(msg).not.toContain("<b>evil</b>")
  })
})
