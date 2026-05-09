import crypto from "crypto"

/**
 * Verify Meta's `X-Hub-Signature-256` header against the App Secret.
 * Used by all three webhook handlers (WhatsApp, Messenger, Instagram).
 * Constant-time compare prevents timing-attack leaks of the secret.
 *
 * @param rawBody  raw request body — STRING or BUFFER. Must NOT be parsed JSON.
 * @param signatureHeader  the value of `X-Hub-Signature-256` header (or undefined).
 * @param appSecret  Meta App Secret from env.
 * @returns true iff the signature matches.
 */
export function verifyMetaSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false
  if (!appSecret) return false

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex")
  const got = signatureHeader.slice("sha256=".length)

  if (got.length !== expected.length) return false

  // crypto.timingSafeEqual throws if buffers have different lengths, so the
  // length check above is a hard precondition.
  try {
    return crypto.timingSafeEqual(
      Buffer.from(got, "hex"),
      Buffer.from(expected, "hex")
    )
  } catch {
    // Buffer.from with malformed hex (odd length, non-hex chars) can throw
    // on stricter Node builds. Treat that as bad signature, never crash the
    // webhook handler.
    return false
  }
}
