/**
 * Pure helper for the weekly "filler" slot — a non-product story (e.g.
 * how-to-order) appended to plans on a configured weekday to add variety
 * without burning anti-repeat product picks.
 *
 * Configuration is env-var-driven so we don't need a schema migration:
 *   STORIES_FILLER_WEEKDAY  — 0..6 (0=Sunday). Empty/missing/out-of-range = disabled
 *   STORIES_FILLER_TEMPLATE — template slug (default "how-to-order")
 *   STORIES_FILLER_TIME     — HH:mm scheduled time (default "10:00")
 */

export type FillerConfig = {
  templateSlug: string
  scheduledTime: string
}

const DEFAULT_TEMPLATE = "how-to-order"
const DEFAULT_TIME = "10:00"
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/

export function resolveFillerForDate(
  planDate: string,
  env: Record<string, string | undefined>,
): FillerConfig | null {
  const rawWeekday = env.STORIES_FILLER_WEEKDAY
  if (rawWeekday == null || rawWeekday.trim() === "") return null

  const weekday = Number.parseInt(rawWeekday, 10)
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null

  const planWeekday = mauritiusWeekdayFromIsoDate(planDate)
  if (planWeekday == null) return null
  if (planWeekday !== weekday) return null

  const templateSlug = env.STORIES_FILLER_TEMPLATE?.trim() || DEFAULT_TEMPLATE
  const rawTime = env.STORIES_FILLER_TIME?.trim() ?? ""
  const scheduledTime = HH_MM.test(rawTime) ? rawTime : DEFAULT_TIME

  return { templateSlug, scheduledTime }
}

/**
 * Returns 0..6 (Sunday=0) for a YYYY-MM-DD plan date, treating the date as a
 * Mauritius local calendar date. Mauritius is UTC+4 with no DST so we can
 * compute the weekday from a UTC date constructor without timezone math.
 */
function mauritiusWeekdayFromIsoDate(planDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(planDate)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(utc.getTime())) return null
  return utc.getUTCDay()
}
