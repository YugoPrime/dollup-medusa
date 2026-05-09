import crypto from "crypto"
import { verifyMetaSignature } from "../lib/verify-meta-signature"

describe("verifyMetaSignature", () => {
  const secret = "test-app-secret"

  it("accepts a correctly signed payload", () => {
    const body = '{"object":"page","entry":[]}'
    const sig =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(body).digest("hex")
    expect(verifyMetaSignature(body, sig, secret)).toBe(true)
  })

  it("accepts a Buffer body (raw mode)", () => {
    const body = Buffer.from('{"object":"page","entry":[]}', "utf8")
    const sig =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(body).digest("hex")
    expect(verifyMetaSignature(body, sig, secret)).toBe(true)
  })

  it("rejects a tampered payload", () => {
    const body = '{"object":"page","entry":[]}'
    const sig =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(body).digest("hex")
    expect(verifyMetaSignature(body + " ", sig, secret)).toBe(false)
  })

  it("rejects a missing signature header", () => {
    expect(verifyMetaSignature("body", undefined, secret)).toBe(false)
  })

  it("rejects a header without the sha256= prefix", () => {
    const sig = crypto.createHmac("sha256", secret).update("body").digest("hex")
    expect(verifyMetaSignature("body", sig, secret)).toBe(false) // missing prefix
  })

  it("rejects equal-length-but-wrong sig (constant-time path)", () => {
    const sig = "sha256=" + "0".repeat(64)
    expect(verifyMetaSignature("body", sig, secret)).toBe(false)
  })

  it("rejects different-length sig without throwing", () => {
    expect(verifyMetaSignature("body", "sha256=abc", secret)).toBe(false)
  })
})
