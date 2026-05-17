import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { isMetaIgConfigured } from "../lib/meta-ig"
import {
  publishStorySlot,
  readAttemptCount,
  readLastAttemptAt,
  readRender,
} from "../lib/publish-story-slot"
import { escapeTelegramHtml, sendTelegram } from "../lib/telegram"
import { STORIES_MODULE } from "../modules/stories"
import type StoriesModuleService from "../modules/stories/service"

const ADMIN_URL = process.env.ADMIN_URL ?? "https://api.dollupboutique.com/app"

const MAX_ATTEMPTS = 3
const COOLDOWN_MS = 15 * 60 * 1000 // 15 minutes between retries
const STALE_WINDOW_MS = 2 * 60 * 60 * 1000 // give up entirely 2h past scheduled

/**
 * Every 5 minutes:
 *   1. Find unposted slots whose scheduled_at has passed but isn't too stale
 *      (within STALE_WINDOW_MS) AND have a rendered MP4 in metadata.render.
 *   2. Filter out slots in cooldown after a recent failure, and slots that
 *      have hit MAX_ATTEMPTS (those get a one-shot Telegram alert on the
 *      tipping attempt).
 *   3. Publish each to IG via publishStorySlot. Per-slot errors don't abort
 *      the loop.
 *
 * Kill-switch: env var META_AUTO_PUBLISH must be "true" for the cron to do
 * any work — protects against accidental publishing while credentials are
 * being verified.
 */
export default async function publishDueStories(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  if (process.env.META_AUTO_PUBLISH !== "true") {
    return // dormant; toggle by setting META_AUTO_PUBLISH=true in Coolify
  }
  if (!isMetaIgConfigured()) {
    logger.warn(
      "[publish-due] META_PAGE_ACCESS_TOKEN or META_IG_BUSINESS_ACCOUNT_ID missing — cannot publish",
    )
    return
  }

  const stories = container.resolve<StoriesModuleService>(STORIES_MODULE)
  const now = Date.now()
  const staleCutoff = new Date(now - STALE_WINDOW_MS)
  const dueCutoff = new Date(now)

  // Medusa v2 list filters: pass posted_at null + scheduled_at range
  // through the generated query builder; cast to any because the typed
  // surface doesn't yet expose comparator operators.
  const candidates = await stories.listStorySlots(
    {
      posted_at: null,
      scheduled_at: { $gte: staleCutoff, $lte: dueCutoff },
    } as any,
    { take: 100 },
  )

  if (candidates.length === 0) return

  for (const slot of candidates) {
    const render = readRender(slot.metadata)
    if (!render) continue // never auto-publish a slot that hasn't been rendered

    const attempts = readAttemptCount(slot.metadata)
    if (attempts >= MAX_ATTEMPTS) continue // gave up; alert was sent at MAX_ATTEMPTS

    const lastAttempt = readLastAttemptAt(slot.metadata)
    if (lastAttempt && now - lastAttempt.getTime() < COOLDOWN_MS) {
      continue // still in cooldown
    }

    const result = await publishStorySlot({ scope: container, slotId: slot.id })
    if (result.ok) {
      logger.info(
        `[publish-due] slot ${slot.id} → media ${result.media_id} in ${result.duration_ms}ms`,
      )
      continue
    }

    logger.error(
      `[publish-due] slot ${slot.id} failed (attempt ${result.attempt_count}): ${result.error}`,
    )

    // One-shot alert when we hit the cap so the operator can intervene.
    if (result.attempt_count >= MAX_ATTEMPTS) {
      const plan = (
        await stories.listStoryPlans({ id: slot.plan_id }).catch(() => [])
      )[0] as { plan_date?: string | Date } | undefined
      const planDate =
        typeof plan?.plan_date === "string"
          ? plan.plan_date.slice(0, 10)
          : plan?.plan_date?.toISOString().slice(0, 10) ?? "unknown date"
      const message = [
        `❌ <b>IG publish gave up</b> after ${MAX_ATTEMPTS} attempts`,
        "",
        `Slot ${escapeTelegramHtml(slot.id)} (plan ${escapeTelegramHtml(planDate)})`,
        `Last error: ${escapeTelegramHtml(result.error)}`,
        result.fbtrace_id
          ? `fbtrace_id: ${escapeTelegramHtml(result.fbtrace_id)}`
          : null,
        "",
        `<a href="${ADMIN_URL}/stories/${planDate}">Open in admin</a>`,
      ]
        .filter((l): l is string => l !== null)
        .join("\n")
      await sendTelegram(message)
    }
  }
}

export const config = {
  name: "publish-due-stories",
  // Every 5 minutes. The actual publish is gated by each slot's
  // scheduled_at + cooldown + attempt cap inside the handler.
  schedule: "*/5 * * * *",
}
