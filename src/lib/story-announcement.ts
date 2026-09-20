/**
 * Pure helper for the daily "announcement" story — a fixed, pre-rendered MP4
 * (shop break, holiday hours, a sale notice) posted to IG Stories every day
 * for a bounded run of dates.
 *
 * Unlike every other slot, this one is NOT rendered: the MP4 is made once,
 * uploaded to R2 by hand, and the slot points straight at it. That is the
 * whole point — it keeps posting while the render laptop is off, which is
 * exactly when a "we're away" notice is needed.
 *
 * Configuration is env-var-driven so no schema migration (and no deploy) is
 * needed to change the message, the time or the end date:
 *   STORIES_ANNOUNCEMENT_MP4_URL  — public MP4 URL. Empty/missing = disabled.
 *   STORIES_ANNOUNCEMENT_UNTIL    — last MU date it posts, YYYY-MM-DD.
 *                                   REQUIRED: without an end date this would
 *                                   post forever, so a missing/invalid value
 *                                   disables the job rather than defaulting.
 *   STORIES_ANNOUNCEMENT_FROM     — optional first MU date, YYYY-MM-DD.
 *   STORIES_ANNOUNCEMENT_TIME     — HH:mm Mauritius time (default "09:00")
 *   STORIES_ANNOUNCEMENT_LABEL    — optional human label, used in logs/alerts
 *
 * ⚠ The MP4 must NOT live under the R2 `stories/` prefix. cleanup-story-renders
 * deletes every key there that isn't `stories/<slotId>/<hash>.mp4`, so an
 * announcement parked in that prefix would vanish on the next nightly sweep.
 * Use a separate prefix, e.g. `announcements/`.
 */

export type AnnouncementConfig = {
  mp4Url: string
  /** HH:mm, Mauritius local. */
  scheduledTime: string
  label: string
}

/**
 * Not a real template — nothing renders this slot. It exists because
 * publish-story-slot's readRender() requires metadata.render.template_slug to
 * be a string, and because it labels the slot clearly in the admin UI.
 */
export const ANNOUNCEMENT_TEMPLATE_SLUG = "announcement"

/** Marks the slot as ours, so re-runs on the same day are a no-op. */
export const ANNOUNCEMENT_CATEGORY_ID = "__announcement__"

const DEFAULT_TIME = "09:00"
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/
const YMD = /^\d{4}-\d{2}-\d{2}$/

export function resolveAnnouncementForDate(
  planDate: string,
  env: Record<string, string | undefined>,
): AnnouncementConfig | null {
  if (!YMD.test(planDate)) return null

  const mp4Url = env.STORIES_ANNOUNCEMENT_MP4_URL?.trim() ?? ""
  if (mp4Url === "") return null
  if (!/^https:\/\//i.test(mp4Url)) return null // Meta only ingests https URLs

  const until = env.STORIES_ANNOUNCEMENT_UNTIL?.trim() ?? ""
  if (!YMD.test(until)) return null
  if (planDate > until) return null

  const from = env.STORIES_ANNOUNCEMENT_FROM?.trim() ?? ""
  if (from !== "") {
    if (!YMD.test(from)) return null
    if (planDate < from) return null
  }

  const rawTime = env.STORIES_ANNOUNCEMENT_TIME?.trim() ?? ""
  const scheduledTime = HH_MM.test(rawTime) ? rawTime : DEFAULT_TIME

  const label = env.STORIES_ANNOUNCEMENT_LABEL?.trim() || "Announcement"

  return { mp4Url, scheduledTime, label }
}

/**
 * When the slot should go out, in UTC.
 *
 * Normally that's the configured MU time on the plan date. But the publish
 * cron only looks back 2 hours (STALE_WINDOW_MS), so a slot created *after*
 * its own time — first run of the day happened late, container was down over
 * the morning, the end date was extended at noon — would be born already too
 * stale to ever post. In that case we push it just ahead of now so it still
 * goes out today instead of silently skipping.
 */
export function resolveAnnouncementScheduledAt(
  planDate: string,
  scheduledTime: string,
  now: Date = new Date(),
): Date {
  const atConfiguredTime = new Date(`${planDate}T${scheduledTime}:00+04:00`)
  if (atConfiguredTime.getTime() > now.getTime()) return atConfiguredTime
  return new Date(now.getTime() + 2 * 60 * 1000)
}
