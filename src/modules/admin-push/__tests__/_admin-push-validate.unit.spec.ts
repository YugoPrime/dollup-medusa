import { validateSubscriptionInput } from "../service"

const valid = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh: "BKey", auth: "authKey" },
  username: "rahvi",
  user_agent: "Mozilla/5.0 (iPhone)",
}

describe("validateSubscriptionInput", () => {
  it("accepts a browser PushSubscription JSON plus username", () => {
    expect(validateSubscriptionInput(valid)).toEqual({
      endpoint: valid.endpoint,
      p256dh: "BKey",
      auth: "authKey",
      username: "rahvi",
      user_agent: "Mozilla/5.0 (iPhone)",
    })
  })

  it("defaults a missing user_agent to null and trims username", () => {
    const out = validateSubscriptionInput({ ...valid, user_agent: undefined, username: "  Rahvi " })
    expect(out.user_agent).toBeNull()
    expect(out.username).toBe("Rahvi")
  })

  it("rejects a non-https endpoint", () => {
    expect(() => validateSubscriptionInput({ ...valid, endpoint: "http://x" })).toThrow(/endpoint/i)
  })

  it("rejects missing keys", () => {
    expect(() => validateSubscriptionInput({ ...valid, keys: { p256dh: "BKey" } })).toThrow(/auth/i)
  })

  it("rejects a missing username", () => {
    expect(() => validateSubscriptionInput({ ...valid, username: "" })).toThrow(/username/i)
  })

  it("caps user_agent at 300 chars", () => {
    const out = validateSubscriptionInput({ ...valid, user_agent: "x".repeat(500) })
    expect(out.user_agent).toHaveLength(300)
  })
})
