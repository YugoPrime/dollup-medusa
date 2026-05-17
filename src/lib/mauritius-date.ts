/**
 * Mauritius is UTC+4 with no DST. Using UTC for "today/tomorrow" calculations
 * rolls the date over a day too early during the 20:00–24:00 UTC window
 * (00:00–04:00 local). All date math here uses the MU offset so cron jobs
 * scheduled in UTC produce the right local date.
 */
const MU_OFFSET_MS = 4 * 60 * 60 * 1000

export function mauritiusToday(now: Date = new Date()): string {
  return new Date(now.getTime() + MU_OFFSET_MS).toISOString().slice(0, 10)
}

export function mauritiusTomorrow(now: Date = new Date()): string {
  const today = mauritiusToday(now)
  const [y, m, d] = today.split("-").map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return next.toISOString().slice(0, 10)
}

/** Add N days (positive or negative) to a "YYYY-MM-DD" date string. */
export function addDaysToMauritiusDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + days))
  return next.toISOString().slice(0, 10)
}
