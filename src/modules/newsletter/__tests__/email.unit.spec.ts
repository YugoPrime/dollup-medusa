import { normalizeEmail } from "../lib/email"

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Jane.Doe@Gmail.COM ")).toBe("jane.doe@gmail.com")
  })
  it("rejects invalid input", () => {
    expect(normalizeEmail("not-an-email")).toBeNull()
    expect(normalizeEmail("a@b")).toBeNull()
    expect(normalizeEmail(42)).toBeNull()
  })
  it("rejects emails over 254 chars", () => {
    expect(normalizeEmail("x".repeat(250) + "@a.io")).toBeNull()
  })
})
