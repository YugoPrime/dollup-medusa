import { resolveAdapter } from "../adapters"

describe("resolveAdapter", () => {
  it("returns the web adapter, which needs no ChannelAccount", () => {
    const a = resolveAdapter("web")
    expect(a.channel).toBe("web")
    expect(a.requiresAccount).toBe(false)
  })

  it("returns the messenger adapter, which does need a ChannelAccount", () => {
    const a = resolveAdapter("messenger")
    expect(a.channel).toBe("messenger")
    expect(a.requiresAccount).toBe(true)
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
