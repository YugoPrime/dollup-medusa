/**
 * Helpers for the daily "announcement" stories: pre-rendered MP4s (a shop
 * break, holiday hours, a sale) that src/jobs/daily-announcement-story.ts
 * queues on today's story plan every day for a bounded run of dates. The usual
 * publish-due-stories cron then posts them to IG (and FB) Stories.
 *
 * Unlike every other slot, these are NOT rendered: each MP4 is made once,
 * uploaded to R2 by hand, and the slot points straight at it. That is the
 * whole point — it keeps posting while the render laptop is off, which is
 * exactly when a "we're away" notice is needed.
 *
 * Configuration is env-var-driven so no schema migration (and no deploy) is
 * needed to change the message, the times or the end date:
 *   STORIES_ANNOUNCEMENT_MP4_URL  — public https MP4 URL. Empty/missing = disabled.
 *                                   May contain {date} (the MU plan date,
 *                                   YYYY-MM-DD) and {n} (the 1-based slot
 *                                   number) so each slot posts its own file,
 *                                   e.g. https://cdn.example.com/sale/{date}-{n}.mp4.
 *                                   Without placeholders every slot posts the
 *                                   same file.
 *   STORIES_ANNOUNCEMENT_UNTIL    — last MU date it posts, YYYY-MM-DD.
 *                                   REQUIRED: without an end date this would
 *                                   post forever, so a missing/invalid value
 *                                   disables the job rather than defaulting.
 *   STORIES_ANNOUNCEMENT_FROM     — optional first MU date, YYYY-MM-DD.
 *   STORIES_ANNOUNCEMENT_TIME     — comma-separated HH:mm, Mauritius time
 *                                   (default "09:00"), e.g. "12:45,17:00,20:00".
 *                                   One slot per time: slot n goes out at the
 *                                   n-th time, in list order. Invalid entries
 *                                   are dropped (the job logs them) and
 *                                   duplicates are removed.
 *   STORIES_ANNOUNCEMENT_LABEL    — optional human label, used in logs/alerts
 *
 * One time and a URL without placeholders is the original single-announcement
 * setup, and it behaves as it always did.
 *
 * With placeholders, each slot's file is checked (HEAD) just before the slot
 * is queued, and a missing file skips that slot. So a story can be pulled by
 * deleting its file before it is queued, which is normally the first hourly
 * run of its MU day (00:07). A queued slot only holds the URL: replacing the
 * file still swaps the story, but pulling it then means deleting the file AND
 * the slot (delete only the slot and the next run queues it again).
 *
 * ⚠ The MP4 must NOT live under the R2 `stories/` prefix. cleanup-story-renders
 * deletes every key there that isn't `stories/<slotId>/<hash>.mp4`, so an
 * announcement parked in that prefix would vanish on the next nightly sweep.
 * Use a separate prefix, e.g. `announcements/` or `campaigns/`.
 */

export type AnnouncementConfig = {
  /** As configured. May hold {date} / {n}: resolve per slot with resolveAnnouncementUrl. */
  mp4Url: string
  /** HH:mm, Mauritius local, in slot order: slot n goes out at scheduledTimes[n - 1]. Never empty. */
  scheduledTimes: string[]
  /** STORIES_ANNOUNCEMENT_TIME entries that weren't HH:mm and were dropped, for the job to log. */
  droppedTimes: string[]
  label: string
  /** mp4Url holds {date} or {n}, so each slot's file is checked before the slot is queued. */
  templated: boolean
}

/**
 * Not a real template — nothing renders this slot. It exists because
 * publish-story-slot's readRender() requires metadata.render.template_slug to
 * be a string, and because it labels the slot clearly in the admin UI.
 */
export const ANNOUNCEMENT_TEMPLATE_SLUG = "announcement"

/** Marks the slot as ours, so re-runs on the same day are a no-op. */
export const ANNOUNCEMENT_CATEGORY_ID = "__announcement__"

/**
 * With 2+ times configured, a slot more than this far past its time is not
 * queued at all that day. Otherwise a deploy at 16:00 would post the
 * morning's stories all at once. A single time never applies it (see
 * planAnnouncementSlots).
 */
export const ANNOUNCEMENT_LATE_START_GRACE_MS = 30 * 60 * 1000

const DEFAULT_TIME = "09:00"
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/
const YMD = /^\d{4}-\d{2}-\d{2}$/
const PLACEHOLDER = /\{(date|n)\}/
const URL_CHECK_TIMEOUT_MS = 5_000

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

  const { times, dropped } = parseAnnouncementTimes(
    env.STORIES_ANNOUNCEMENT_TIME,
  )

  const label = env.STORIES_ANNOUNCEMENT_LABEL?.trim() || "Announcement"

  return {
    mp4Url,
    scheduledTimes: times,
    droppedTimes: dropped,
    label,
    templated: hasAnnouncementPlaceholders(mp4Url),
  }
}

/**
 * "12:45, 17:00,20:00" → ["12:45", "17:00", "20:00"]. Keeps list order
 * (slot n = n-th time), drops anything that isn't HH:mm and removes
 * duplicates. Falls back to 09:00 when nothing valid is left, which is also
 * what a single malformed time always did.
 */
export function parseAnnouncementTimes(raw: string | undefined): {
  times: string[]
  dropped: string[]
} {
  const times: string[] = []
  const dropped: string[] = []
  for (const part of (raw ?? "").split(",")) {
    const entry = part.trim()
    if (entry === "") continue // "12:45," — a stray comma isn't an entry
    if (!HH_MM.test(entry)) {
      dropped.push(entry)
      continue
    }
    if (!times.includes(entry)) times.push(entry)
  }
  return { times: times.length > 0 ? times : [DEFAULT_TIME], dropped }
}

export function hasAnnouncementPlaceholders(url: string): boolean {
  return PLACEHOLDER.test(url)
}

/** Fills {date} (MU plan date, YYYY-MM-DD) and {n} (1-based slot number). */
export function resolveAnnouncementUrl(
  template: string,
  planDate: string,
  n: number,
): string {
  return template.replaceAll("{date}", planDate).replaceAll("{n}", String(n))
}

/**
 * The slot number recorded in metadata.announcement.n. A slot queued before
 * multi-slot support has none, and counts as slot 1.
 */
export function readAnnouncementIndex(metadata: unknown): number {
  const block = (metadata as { announcement?: { n?: unknown } | null } | null)
    ?.announcement
  const n = block?.n
  return typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : 1
}

/** Slot numbers 1..slotCount that today's plan doesn't have yet. */
export function missingAnnouncementIndexes(
  slotCount: number,
  slots: ReadonlyArray<{ category_id: string; metadata?: unknown }>,
): number[] {
  const present = new Set(
    slots
      .filter((s) => s.category_id === ANNOUNCEMENT_CATEGORY_ID)
      .map((s) => readAnnouncementIndex(s.metadata)),
  )
  const missing: number[] = []
  for (let n = 1; n <= slotCount; n++) {
    if (!present.has(n)) missing.push(n)
  }
  return missing
}

/** True once `now` is more than `graceMs` past the slot's MU time. */
export function isAnnouncementTimePassed(
  planDate: string,
  scheduledTime: string,
  now: Date = new Date(),
  graceMs: number = ANNOUNCEMENT_LATE_START_GRACE_MS,
): boolean {
  const at = new Date(`${planDate}T${scheduledTime}:00+04:00`)
  return now.getTime() - at.getTime() > graceMs
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

export type AnnouncementUrlCheck =
  | { ok: true; status: number }
  | { ok: false; status?: number; reason: string }

export type AnnouncementUrlChecker = (
  url: string,
) => Promise<AnnouncementUrlCheck>

/**
 * Is the MP4 at `url` there right now? HEAD first; a server that refuses HEAD
 * (405/501) gets a one-byte ranged GET instead. Only a 2xx counts. Never
 * throws: a timeout or a network error comes back as { ok: false }.
 *
 * `fetchImpl` is the test seam, so this runs in tests without real HTTP.
 */
export async function checkAnnouncementUrl(
  url: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<AnnouncementUrlCheck> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? URL_CHECK_TIMEOUT_MS
  const is2xx = (status: number) => status >= 200 && status < 300
  try {
    const head = await fetchImpl(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (is2xx(head.status)) return { ok: true, status: head.status }
    if (head.status !== 405 && head.status !== 501) {
      return { ok: false, status: head.status, reason: `HTTP ${head.status}` }
    }

    const get = await fetchImpl(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    })
    // A server that ignores Range answers 200 with the whole MP4: don't
    // download it just to throw it away.
    await get.body?.cancel().catch(() => undefined)
    if (is2xx(get.status)) return { ok: true, status: get.status }
    return { ok: false, status: get.status, reason: `HTTP ${get.status}` }
  } catch (err) {
    const e = err as Error | undefined
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return { ok: false, reason: `no response within ${timeoutMs} ms` }
    }
    return { ok: false, reason: e?.message || "request failed" }
  }
}

export type AnnouncementSlotPlan = {
  /** 1-based slot number. */
  n: number
  /** HH:mm, Mauritius local, as configured. */
  time: string
  /** The resolved URL, placeholders filled in. */
  mp4Url: string
} & (
  | { action: "add"; scheduledAt: Date }
  | { action: "skip-time-passed" }
  | { action: "skip-missing-file"; reason: string }
)

/**
 * Decides, for every slot number today's plan is still missing, whether to
 * queue it now. In order:
 *   1. Late-start guard, only with 2+ times: more than 30 min past its time
 *      → skip for today. A single slot can't bunch up with anything, so it
 *      keeps the original behaviour: queued late, it goes out a couple of
 *      minutes later rather than not at all (resolveAnnouncementScheduledAt).
 *   2. URL check, only when the URL has placeholders: no 2xx → skip. With a
 *      fixed URL nothing is checked, as before.
 *   3. Otherwise queue it at its time (or just ahead of now, if that's gone).
 *
 * Doesn't write anything. `checkUrl` is injected so tests run without HTTP.
 */
export async function planAnnouncementSlots(args: {
  planDate: string
  cfg: AnnouncementConfig
  existingSlots: ReadonlyArray<{ category_id: string; metadata?: unknown }>
  now: Date
  checkUrl: AnnouncementUrlChecker
}): Promise<AnnouncementSlotPlan[]> {
  const { planDate, cfg, now } = args
  const guarded = cfg.scheduledTimes.length > 1
  const plans: AnnouncementSlotPlan[] = []

  for (const n of missingAnnouncementIndexes(
    cfg.scheduledTimes.length,
    args.existingSlots,
  )) {
    const time = cfg.scheduledTimes[n - 1]
    const mp4Url = resolveAnnouncementUrl(cfg.mp4Url, planDate, n)

    if (guarded && isAnnouncementTimePassed(planDate, time, now)) {
      plans.push({ n, time, mp4Url, action: "skip-time-passed" })
      continue
    }

    if (cfg.templated) {
      const check = await args.checkUrl(mp4Url)
      if (!check.ok) {
        plans.push({
          n,
          time,
          mp4Url,
          action: "skip-missing-file",
          reason: check.reason,
        })
        continue
      }
    }

    plans.push({
      n,
      time,
      mp4Url,
      action: "add",
      scheduledAt: resolveAnnouncementScheduledAt(planDate, time, now),
    })
  }

  return plans
}
