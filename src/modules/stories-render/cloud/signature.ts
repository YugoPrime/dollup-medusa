import { createHmac, timingSafeEqual } from "crypto"

const MAX_SKEW_SEC = 300
const DIGITS_RE = /^\d{1,15}$/
const SHA256_HEX_RE = /^[0-9a-fA-F]{64}$/

/**
 * Header: `t=<unix seconds>,v1=<hex>`; v1 = HMAC-SHA256(secret, "<t>.<raw body>").
 * Rejects |now - t| > 300 s. Never logs the secret or the signature.
 */
export function verifyRenderSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string,
  nowSec: number
): boolean {
  if (!header || !secret || !Buffer.isBuffer(rawBody)) return false

  let t: string | undefined
  let v1: string | undefined
  for (const part of header.split(",")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key === "t") t = value
    else if (key === "v1") v1 = value
  }
  if (t === undefined || v1 === undefined) return false
  if (!DIGITS_RE.test(t) || !SHA256_HEX_RE.test(v1)) return false
  if (Math.abs(nowSec - Number(t)) > MAX_SKEW_SEC) return false

  const expected = createHmac("sha256", secret)
    .update(`${t}.`)
    .update(rawBody)
    .digest()
  const given = Buffer.from(v1, "hex")
  if (given.length !== expected.length) return false
  return timingSafeEqual(given, expected)
}
