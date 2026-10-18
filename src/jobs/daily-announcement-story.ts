import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { mauritiusToday } from "../lib/mauritius-date"
import {
  ANNOUNCEMENT_CATEGORY_ID,
  ANNOUNCEMENT_TEMPLATE_SLUG,
  checkAnnouncementUrl,
  planAnnouncementSlots,
  resolveAnnouncementForDate,
  type AnnouncementSlotPlan,
} from "../lib/story-announcement"
import { escapeTelegramHtml, sendTelegram } from "../lib/telegram"
import { STORIES_MODULE } from "../modules/stories"
import type StoriesModuleService from "../modules/stories/service"

/**
 * The MU date the "file missing" alert last went out for. In memory on
 * purpose: no table, no migration. A container restart can repeat the alert
 * once that day, which is fine for a nudge.
 */
let missingFileAlertSentFor: string | null = null

/**
 * Queues today's pre-rendered "announcement" stories: one slot per time in
 * STORIES_ANNOUNCEMENT_TIME, every day, for a bounded run of dates (see
 * src/lib/story-announcement.ts for the env vars). The existing
 * publish-due-stories cron then posts them to IG Stories with the usual
 * retry + alerting.
 *
 * Nothing renders here: each slot is born with metadata.render already
 * pointing at its MP4, which is what lets announcements keep going out while
 * the render laptop is off. It also keeps the slots invisible to the local
 * render poller, which skips any slot that already has metadata.render.
 *
 * Idempotent per slot: each slot records its 1-based number in
 * metadata.announcement.n, and a run only adds the numbers today's plan is
 * still missing. A slot queued before multi-slot support has no n and counts
 * as slot 1.
 *
 * With 2+ times, a slot more than 30 min past its time is skipped for the
 * day ("skipped, time passed"), so a deploy at 16:00 doesn't post the
 * morning's stories all at once. A single time keeps the original behaviour:
 * queued late, it still goes out a couple of minutes later.
 *
 * When the URL has {date}/{n} placeholders, each slot's file gets a HEAD
 * before the slot is queued. A missing file skips that slot until a later
 * run finds it, and one Telegram alert per MU day lists what's missing.
 *
 * Kill-switch: unset STORIES_ANNOUNCEMENT_MP4_URL (or let
 * STORIES_ANNOUNCEMENT_UNTIL pass) and the job goes dormant on its own.
 *
 * Depends on publish-due-stories, so META_AUTO_PUBLISH must be "true" for the
 * slots to actually reach Instagram.
 */
export default async function dailyAnnouncementStory(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const planDate = mauritiusToday()
  const cfg = resolveAnnouncementForDate(planDate, process.env)
  if (!cfg) return // dormant, or the run of dates is over

  if (cfg.droppedTimes.length > 0) {
    logger.warn(
      `[announcement] STORIES_ANNOUNCEMENT_TIME: ignored ${cfg.droppedTimes
        .map((t) => `"${t}"`)
        .join(", ")} (not HH:mm) — using ${cfg.scheduledTimes.join(",")}`,
    )
  }

  const stories = container.resolve<StoriesModuleService>(STORIES_MODULE)
  const total = cfg.scheduledTimes.length

  try {
    let [plan] = await stories.listStoryPlans(
      { plan_date: planDate } as any,
      { take: 1 },
    )

    // Normally create-tomorrow-plan has already made today's plan. It may not
    // have (auto-plan disabled, container down at 18:00 MU) — the announcement
    // must not depend on that, so fall back to an empty plan of its own.
    if (!plan) {
      plan = (await stories.createPlan({
        plan_date: planDate,
        category_distribution: [],
        scheduled_times: [],
        notes: `Auto-created for the daily announcement story (${cfg.label})`,
      })) as typeof plan
      logger.info(
        `[announcement] no plan for ${planDate} — created empty plan ${plan.id}`,
      )
    }

    const slots = await stories.listStorySlots({ plan_id: plan.id })
    const decisions = await planAnnouncementSlots({
      planDate,
      cfg,
      existingSlots: slots,
      now: new Date(),
      checkUrl: checkAnnouncementUrl,
    })
    if (decisions.length === 0) {
      logger.info(
        `[announcement] ${planDate}: ${total === 1 ? "slot" : `all ${total} slots`} already present — skipping`,
      )
      return
    }

    const missingFiles: Array<
      Extract<AnnouncementSlotPlan, { action: "skip-missing-file" }>
    > = []

    for (const d of decisions) {
      const tag = `${planDate} #${d.n} (${d.time})`

      if (d.action === "skip-time-passed") {
        logger.info(`[announcement] ${tag}: skipped, time passed`)
        continue
      }
      if (d.action === "skip-missing-file") {
        logger.warn(
          `[announcement] ${tag}: skipped, file not reachable (${d.reason}) — ${d.mp4Url}`,
        )
        missingFiles.push(d)
        continue
      }

      const { slot_id } = await stories.addFillerSlot({
        plan_id: plan.id,
        template_slug: ANNOUNCEMENT_TEMPLATE_SLUG,
        scheduled_at: d.scheduledAt,
        category_id: ANNOUNCEMENT_CATEGORY_ID,
      })

      // Written immediately after creation so the render poller never sees an
      // unrendered slot. The gap is sub-second; if a poller tick did land inside
      // it the worst case is one "template not found" warning — the render block
      // below still lands and the slot still publishes.
      await stories.updateSlotMetadata(slot_id, {
        announcement: {
          n: d.n,
          label: cfg.label,
          mp4_url: d.mp4Url,
          added_at: new Date().toISOString(),
        },
        render: {
          template_slug: ANNOUNCEMENT_TEMPLATE_SLUG,
          mp4_url: d.mp4Url,
        },
      })

      logger.info(
        `[announcement] ${tag}: slot ${slot_id} queued for ${d.scheduledAt.toISOString()} (${cfg.label}) — ${d.mp4Url}`,
      )
    }

    if (missingFiles.length > 0 && missingFileAlertSentFor !== planDate) {
      const sent = await sendTelegram(
        [
          `⚠️ <b>Announcement story file missing</b> — ${escapeTelegramHtml(planDate)}`,
          "",
          escapeTelegramHtml(cfg.label),
          ...missingFiles.map(
            (d) =>
              `#${d.n} at ${d.time}: ${escapeTelegramHtml(d.reason)}\n${escapeTelegramHtml(d.mp4Url)}`,
          ),
          "",
          total > 1
            ? "Not queued. Upload the file and the next hourly run (:07) queues it, up to 30 min after its time."
            : "Not queued. Upload the file and the next hourly run (:07) queues it.",
        ].join("\n"),
      )
      // A failed send is retried next tick; at most one alert lands per day.
      if (sent.ok || "skipped" in sent) missingFileAlertSentFor = planDate
    }
  } catch (err) {
    const msg = (err as Error)?.message ?? "announcement slot failed"
    logger.error(`[announcement] ${planDate}: ${msg}`)
    // Louder than the weekly filler's log-and-continue: during a shop break
    // this is often the only story going out, so a silent failure means the
    // customers never hear anything.
    await sendTelegram(
      [
        `⚠️ <b>Announcement story not queued</b> — ${escapeTelegramHtml(planDate)}`,
        "",
        `${escapeTelegramHtml(cfg.label)}`,
        `Error: ${escapeTelegramHtml(msg)}`,
      ].join("\n"),
    )
  }
}

export const config = {
  name: "daily-announcement-story",
  // Hourly rather than once a day, on purpose. The handler is idempotent and
  // costs two reads when there's nothing to do, and hourly means a redeploy,
  // a container restart or a late change to the end date still gets the
  // slots in before the day is out. It also self-heals the one way these
  // slots can disappear: regeneratePlan deletes every unposted slot and
  // rebuilds from the plan's category_distribution, so an admin pressing
  // "Regenerate" drops the announcements (same as it drops the weekly filler)
  // — the next tick puts back the ones still due (with 2+ times, not one
  // already more than 30 min past). :07 keeps it off the same minute as the
  // other crons.
  schedule: "7 * * * *",
}
