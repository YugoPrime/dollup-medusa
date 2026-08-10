import { resolveAdapter } from "../adapters"

describe("resolveAdapter", () => {
  it("returns the web adapter", () => {
    expect(resolveAdapter("web").channel).toBe("web")
  })

  it("returns the messenger adapter", () => {
    expect(resolveAdapter("messenger").channel).toBe("messenger")
  })

  it("web has no reply window", () => {
    expect(resolveAdapter("web").replyWindowEndsAt({ last_inbound_at: null })).toBeNull()
  })

  it("messenger's reply window ends 24h after the last inbound", () => {
    const last = new Date("2026-08-10T00:00:00.000Z")
    const end = resolveAdapter("messenger").replyWindowEndsAt({ last_inbound_at: last })
    expect(end?.toISOString()).toBe("2026-08-11T00:00:00.000Z")
  })

  it("messenger has no reply window when nothing inbound has arrived yet", () => {
    expect(resolveAdapter("messenger").replyWindowEndsAt({ last_inbound_at: null })).toBeNull()
  })

  it("throws on a channel with no adapter yet", () => {
    expect(() => resolveAdapter("whatsapp")).toThrow(/no adapter/i)
  })
})
