import { createHmac, timingSafeEqual } from "crypto"

/**
 * Verifies a Resend (Svix) webhook signature without the svix package.
 * Signed content is `${svix-id}.${svix-timestamp}.${raw body}`, HMAC-SHA256 with the
 * base64 secret that follows the `whsec_` prefix. The header holds one or more
 * space-separated `v1,<base64>` entries; any match passes.
 */
export function verifySvixSignature(input: {
  payload: string
  id: string | undefined
  timestamp: string | undefined
  signature: string | undefined
  secret: string
  nowSeconds?: number
  toleranceSeconds?: number
}): boolean {
  const { payload, id, timestamp, signature, secret } = input
  if (!secret || !id || !timestamp || !signature) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  const tolerance = input.toleranceSeconds ?? 5 * 60
  // Replay protection: reject anything signed too long ago (or too far ahead).
  if (Math.abs(now - ts) > tolerance) return false

  let key: Buffer
  try {
    key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64")
  } catch {
    return false
  }
  if (key.length === 0) return false

  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest()

  for (const part of signature.split(" ")) {
    const [version, sig] = part.split(",", 2)
    if (version !== "v1" || !sig) continue
    let given: Buffer
    try {
      given = Buffer.from(sig, "base64")
    } catch {
      continue
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true
  }
  return false
}
