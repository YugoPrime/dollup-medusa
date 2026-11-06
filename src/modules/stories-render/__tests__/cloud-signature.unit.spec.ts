import { createHmac } from "crypto"
import { verifyRenderSignature } from "../cloud/signature"

const SECRET = "test-secret"
const NOW = 1_800_000_000
const BODY = Buffer.from('{"job_id":"x","status":"ok"}')

function sign(body: Buffer, secret: string, t: number): string {
  const v1 = createHmac("sha256", secret)
    .update(`${t}.`)
    .update(body)
    .digest("hex")
  return `t=${t},v1=${v1}`
}

describe("verifyRenderSignature", () => {
  it("accepts a valid signature", () => {
    expect(verifyRenderSignature(BODY, sign(BODY, SECRET, NOW), SECRET, NOW)).toBe(true)
  })

  it("rejects a wrong secret", () => {
    expect(verifyRenderSignature(BODY, sign(BODY, "other", NOW), SECRET, NOW)).toBe(false)
  })

  it("rejects a body changed by one byte", () => {
    const header = sign(BODY, SECRET, NOW)
    const tampered = Buffer.from(BODY)
    tampered[3] = tampered[3] ^ 1
    expect(verifyRenderSignature(tampered, header, SECRET, NOW)).toBe(false)
  })

  it("rejects timestamps more than 300 s away, accepts exactly 300", () => {
    expect(verifyRenderSignature(BODY, sign(BODY, SECRET, NOW - 301), SECRET, NOW)).toBe(false)
    expect(verifyRenderSignature(BODY, sign(BODY, SECRET, NOW + 301), SECRET, NOW)).toBe(false)
    expect(verifyRenderSignature(BODY, sign(BODY, SECRET, NOW - 300), SECRET, NOW)).toBe(true)
  })

  it("rejects an empty secret", () => {
    expect(verifyRenderSignature(BODY, sign(BODY, "", NOW), "", NOW)).toBe(false)
  })

  it("rejects malformed headers", () => {
    const good = sign(BODY, SECRET, NOW)
    const v1 = good.split("v1=")[1]
    expect(verifyRenderSignature(BODY, undefined, SECRET, NOW)).toBe(false)
    expect(verifyRenderSignature(BODY, "", SECRET, NOW)).toBe(false)
    expect(verifyRenderSignature(BODY, `t=${NOW},v1=`, SECRET, NOW)).toBe(false)
    expect(verifyRenderSignature(BODY, `t=abc,v1=${v1}`, SECRET, NOW)).toBe(false)
    expect(verifyRenderSignature(BODY, `t=${NOW},v1=${v1.slice(1)}`, SECRET, NOW)).toBe(false)
    expect(verifyRenderSignature(BODY, `t=${NOW},v1=${"zz".repeat(32)}`, SECRET, NOW)).toBe(false)
    expect(verifyRenderSignature(BODY, `v1=${v1}`, SECRET, NOW)).toBe(false)
    expect(verifyRenderSignature(BODY, `t=${NOW}`, SECRET, NOW)).toBe(false)
  })
})
