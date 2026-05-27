import { randomBytes } from "node:crypto"

export const RECOVERY_COUPON_PREFIX = "RECOVER"
// Base32-ish, ambiguous chars (0/O/1/I) removed.
export const RECOVERY_COUPON_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export function generateCouponCode(suffixLength = 5): string {
  const bytes = randomBytes(suffixLength)
  let suffix = ""
  for (let i = 0; i < suffixLength; i++) {
    suffix += RECOVERY_COUPON_ALPHABET[bytes[i]! % RECOVERY_COUPON_ALPHABET.length]
  }
  return `${RECOVERY_COUPON_PREFIX}-${suffix}`
}

export function couponExpiryISO(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}
