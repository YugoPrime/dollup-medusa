import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { mauritiusToday } from "../lib/mauritius-date"
import {
  ANNOUNCEMENT_CATEGORY_ID,
  ANNOUNCEMENT_TEMPLATE_SLUG,
  resolveAnnouncementForDate,
  resolveAnnouncementScheduledAt,
} from "../lib/story-announcement"
import { escapeTelegramHtml, sendTelegram } from "../lib/telegram"
import { STORIES_MODULE } from "../modules/stories"
import type StoriesModuleService from "../modules/stories/service"

/**
 * Appends one pre-rendered "announcement" slot to today's plan, every day, for
 * a bounded run of dates (see src/lib/story-announcement.ts for the env vars).
 * The existing publish-due-stories cron then posts it to IG Stories with the
 * usual retry + alerting.
 *
 * Nothing renders here: the slot is born with metadata.render already pointing
 * at a fixed MP4, which is what lets the announcement keep going out while the
 * render laptop is off. It also keeps the slot invisible to the local render
 * poller, which skips any slot that already has metadata.render.
 *
 * Idempotent: a second run on the same MU day finds the existing announcement
 * slot and exits. Kill-switch: unset STORIES_ANNOUNCEMENT_MP4_URL (or let
 * STORIES_ANNOUNCEMENT_UNTIL pass) and the job goes dormant on its own.
 *
 * Depends on publish-due-stories, so META_AUTO_PUBLISH must be "true" for the
 * slot to actually reach Instagram.
 */
export default async function dailyAnnouncementStory(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const planDate = mauritiusToday()
  const cfg = resolveAnnouncementForDate(planDate, process.env)
  if (!cfg) return // dormant, or the run of dates is over

  const stories = container.resolve<StoriesModuleService>(STORIES_MODULE)

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
    const existing = slots.find(
      (s) => s.category_id === ANNOUNCEMENT_CATEGORY_ID,
    )
    if (existing) {
      logger.info(
        `[announcement] ${planDate}: slot ${existing.id} already present — skipping`,
      )
      return
    }

    const scheduledAt = resolveAnnouncementScheduledAt(
      planDate,
      cfg.scheduledTime,
    )

    const { slot_id } = await stories.addFillerSlot({
      plan_id: plan.id,
      template_slug: ANNOUNCEMENT_TEMPLATE_SLUG,
      scheduled_at: scheduledAt,
      category_id: ANNOUNCEMENT_CATEGORY_ID,
    })

    // Written immediately after creation so the render poller never sees an
    // unrendered slot. The gap is sub-second; if a poller tick did land inside
    // it the worst case is one "template not found" warning — the render block
    // below still lands and the slot still publishes.
    await stories.updateSlotMetadata(slot_id, {
      announcement: {
        label: cfg.label,
        mp4_url: cfg.mp4Url,
        added_at: new Date().toISOString(),
      },
      render: {
        template_slug: ANNOUNCEMENT_TEMPLATE_SLUG,
        mp4_url: cfg.mp4Url,
      },
    })

    logger.info(
      `[announcement] ${planDate}: slot ${slot_id} queued for ${scheduledAt.toISOString()} (${cfg.label})`,
    )
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
  // a container restart or a late change to the end date still gets the slot
  // in before the day is out. It also self-heals the one way this slot can
  // disappear: regeneratePlan deletes every unposted slot and rebuilds from
  // the plan's category_distribution, so an admin pressing "Regenerate" drops
  // the announcement (same as it drops the weekly filler) — the next tick
  // puts it back. :07 keeps it off the same minute as the other crons.
  schedule: "7 * * * *",
}
