import { newSessionId, isValidSessionId } from "../lib/session-id"

describe("session ids", () => {
  it("are 43-char base64url", () => {
    expect(newSessionId()).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it("are unguessable — no two are alike", () => {
    const seen = new Set(Array.from({ length: 50 }, () => newSessionId()))
    expect(seen.size).toBe(50)
  })

  it("reject malformed values", () => {
    expect(isValidSessionId("short")).toBe(false)
    expect(isValidSessionId("a".repeat(43) + "!")).toBe(false)
    expect(isValidSessionId("a".repeat(44))).toBe(false)
    expect(isValidSessionId(null)).toBe(false)
    expect(isValidSessionId(undefined)).toBe(false)
    expect(isValidSessionId(12345)).toBe(false)
  })

  it("accept what newSessionId produces", () => {
    expect(isValidSessionId(newSessionId())).toBe(true)
  })
})
