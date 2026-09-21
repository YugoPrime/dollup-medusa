/**
 * The shop break, for anything the backend sends a customer.
 *
 * Mirrors SERVICE_RESUMES_YMD in the storefront's src/lib/checkout.ts — if one
 * moves, move the other, or the site and the emails promise different dates.
 *
 * Self-expiring: every caller compares against the live Mauritius day, so the
 * notice stops appearing on the resume date with no deploy and no env change.
 * SHOP_BREAK_RESUMES_ON overrides the date (set it to a past date to end the
 * break early, e.g. if we come back sooner than planned).
 */
import { mauritiusToday } from "./mauritius-date"

const DEFAULT_RESUMES_ON = "2026-10-17"
const YMD = /^\d{4}-\d{2}-\d{2}$/

export function shopBreakResumesOn(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.SHOP_BREAK_RESUMES_ON?.trim() ?? ""
  return YMD.test(override) ? override : DEFAULT_RESUMES_ON
}

/** True while the break is still on (MU calendar day before the resume date). */
export function shopBreakActive(
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): boolean {
  return mauritiusToday(now) < shopBreakResumesOn(env)
}

/** "17/10" — how the resume date is written to customers. */
export function shopBreakResumesLabel(
  env: Record<string, string | undefined> = process.env,
): string {
  const [, m, d] = shopBreakResumesOn(env).split("-")
  return `${d}/${m}`
}
