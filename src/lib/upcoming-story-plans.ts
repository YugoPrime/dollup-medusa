import { addDaysToMauritiusDate, mauritiusToday } from "./mauritius-date"
import type StoriesModuleService from "../modules/stories/service"

export function normalizePlanDate(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 10)
  if (value instanceof Date) {
    // Postgres `date` columns come back as midnight in the server's local TZ;
    // calling .toISOString() shifts the moment into UTC which can land on
    // the previous calendar day for UTC+N timezones (e.g. Mauritius UTC+4 -> -4h).
    // Use the local components instead so the calendar day is preserved.
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, "0")
    const d = String(value.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
  }
  return String(value).slice(0, 10)
}

/** Plans dated today ... today + lookaheadDays (MU dates, both inclusive), oldest first. */
export async function listUpcomingPlans(
  stories: Pick<StoriesModuleService, "listStoryPlans">,
  lookaheadDays: number,
  today: string = mauritiusToday(),
): Promise<Array<{ id: string; plan_date: string }>> {
  // listStoryPlans has no "between dates" filter exposed, so list a generous
  // window and filter in-process. Volumes are small (<= 30 plans).
  const allPlans = await stories.listStoryPlans({} as any, { take: 200 })
  const planDates = new Set<string>()
  for (let i = 0; i <= lookaheadDays; i++) {
    planDates.add(addDaysToMauritiusDate(today, i))
  }
  return allPlans
    .map((p) => ({ id: p.id, plan_date: normalizePlanDate(p.plan_date) }))
    .filter((p) => planDates.has(p.plan_date))
    .sort((a, b) => a.plan_date.localeCompare(b.plan_date))
}
