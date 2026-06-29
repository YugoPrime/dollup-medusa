import crypto from "crypto"

/**
 * Verify Rapido's `X-Rapido-Signature` header (`sha256=<hex>`) against the
 * webhook signing secret. Operates on the RAW request body — never parsed JSON,
 * or the re-serialized bytes won't match Rapido's HMAC.
 */
export function verifyRapidoSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false
  if (!secret) return false

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
  const got = signatureHeader.slice("sha256=".length)
  if (got.length !== expected.length) return false

  try {
    return crypto.timingSafeEqual(
      Buffer.from(got, "hex"),
      Buffer.from(expected, "hex"),
    )
  } catch {
    return false
  }
}
