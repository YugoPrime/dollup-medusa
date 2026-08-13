/**
 * Shared "is this address worth sending to" predicate.
 *
 * Lives here rather than in notification-resend/service.ts so pure consumers
 * (the notification-health summarizer, unit tests) can import it without
 * dragging in `resend`, React and every .tsx email template — jest's transform
 * only covers .[jt]s, so importing the service from a unit test fails outright.
 */

// RFC 2606 reserved TLDs that will never resolve on the public internet.
// dollup-admin synthesizes `dm-<phone>@dollupboutique.local` for DM orders
// where the customer has no real email — sending to them guarantees a bounce
// and erodes Resend domain reputation.
const NON_SENDABLE_TLDS = new Set([
  "local",
  "localhost",
  "test",
  "invalid",
  "example",
])

export function isSendableEmail(addr: string): boolean {
  if (typeof addr !== "string") return false
  const at = addr.lastIndexOf("@")
  if (at < 1 || at === addr.length - 1) return false
  const domain = addr.slice(at + 1).toLowerCase()
  const tld = domain.includes(".") ? domain.split(".").pop()! : domain
  return !NON_SENDABLE_TLDS.has(tld)
}
