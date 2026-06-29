import crypto from "crypto"
import { verifyRapidoSignature } from "../verify-rapido-signature"

const secret = "test_secret"
const body = JSON.stringify({ orderNumber: "RPD-1", status: "DELIVERED" })
const goodSig =
  "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex")

describe("verifyRapidoSignature", () => {
  it("accepts a correct signature", () => {
    expect(verifyRapidoSignature(body, goodSig, secret)).toBe(true)
  })
  it("rejects a wrong signature", () => {
    expect(verifyRapidoSignature(body, "sha256=deadbeef", secret)).toBe(false)
  })
  it("rejects a missing header", () => {
    expect(verifyRapidoSignature(body, undefined, secret)).toBe(false)
  })
  it("rejects a header without the sha256= prefix", () => {
    expect(verifyRapidoSignature(body, "abc123", secret)).toBe(false)
  })
  it("rejects when secret is empty", () => {
    expect(verifyRapidoSignature(body, goodSig, "")).toBe(false)
  })
})
