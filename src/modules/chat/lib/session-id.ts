import { randomBytes } from "node:crypto"

/**
 * The session id IS the bearer credential for the widget: 32 random bytes
 * (256 bits), base64url, so it cannot be guessed or enumerated. It is stored
 * as Contact.external_id for channel="web". Deliberately NOT derived from the
 * thread id — a leaked thread id must grant nothing.
 */
export function newSessionId(): string {
  return randomBytes(32).toString("base64url")
}

/** 32 bytes of base64url is always exactly 43 characters with no padding. */
export function isValidSessionId(value: unknown): boolean {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)
}
