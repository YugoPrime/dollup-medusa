import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { mauritiusTomorrow } from "../lib/mauritius-date"
import { escapeTelegramHtml, sendTelegram } from "../lib/telegram"
import { STORIES_MODULE } from "../modules/stories"
import { createMedusaProductSource } from "../modules/stories/product-source"
import type StoriesModuleService from "../modules/stories/service"
import {
  batchRenderPlan,
  summarizeBatch,
} from "../modules/stories-render/batch"

const ADMIN_URL = process.env.ADMIN_URL ?? "https://api.dollupboutique.com/app"

/**
 * Daily auto-pilot for the story planner:
 *   1. resolve tomorrow's MU date
 *   2. skip if a plan already exists for that date
 *   3. read settings.default_distribution + default_schedule
 *   4. create plan + regenerate (pick products + snapshot)
 *   5. batch-render every slot via the picker
 *   6. ping Telegram with the result
 *
 * Idempotent: re-running on the same day after a plan is created is a no-op.
 * Settings act as the kill-switch — if default_distribution or
 * default_schedule are empty / mismatched, the job logs + alerts and exits
 * without creating anything.
 */
export default async function createTomorrowPlan(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const stories = container.resolve<StoriesModuleService>(STORIES_MODULE)

  const planDate = mauritiusTomorrow()

  const existing = await stories.listStoryPlans(
    { plan_date: planDate } as any,
    { take: 1 },
  )
  if (existing.length > 0) {
    logger.info(
      `[auto-plan] ${planDate} already has plan ${existing[0].id} — skipping`,
    )
    return
  }

  const settings = await stories.getSettings()
  const totalSlots = settings.default_distribution.reduce(
    (sum, bucket) => sum + bucket.count,
    0,
  )

  if (totalSlots === 0 || settings.default_schedule.length === 0) {
    logger.warn(
      `[auto-plan] settings.default_distribution and default_schedule must be configured before auto-plan runs; skipping ${planDate}`,
    )
    return
  }

  if (totalSlots !== settings.default_schedule.length) {
    const msg =
      `default_distribution count sum (${totalSlots}) doesn't match default_schedule length (${settings.default_schedule.length})`
    logger.error(`[auto-plan] ${msg} — fix in /settings/stories`)
    await sendTelegram(
      `⚠️ <b>Auto-plan skipped for ${escapeTelegramHtml(planDate)}</b>\n\n${escapeTelegramHtml(msg)}\n\nFix in <a href="${ADMIN_URL}/settings/stories">/settings/stories</a>.`,
    )
    return
  }

  let plan
  try {
    plan = await stories.createPlan({
      plan_date: planDate,
      category_distribution: settings.default_distribution,
      scheduled_times: settings.default_schedule,
      notes: "auto-created by create-tomorrow-plan cron",
    })
  } catch (err) {
    const msg = (err as Error)?.message ?? "createPlan failed"
    logger.error(`[auto-plan] failed to create plan for ${planDate}: ${msg}`)
    await sendTelegram(
      `⚠️ Auto-plan create-plan failed for ${escapeTelegramHtml(planDate)}: ${escapeTelegramHtml(msg)}`,
    )
    return
  }

  const productSource = createMedusaProductSource(container)
  try {
    await stories.regeneratePlan(plan.id, { productSource })
  } catch (err) {
    const msg = (err as Error)?.message ?? "regeneratePlan failed"
    logger.error(`[auto-plan] regenerate failed for plan ${plan.id}: ${msg}`)
    await sendTelegram(
      `⚠️ Auto-plan regenerate failed for ${escapeTelegramHtml(planDate)}: ${escapeTelegramHtml(msg)}`,
    )
    return
  }

  // Count slots that came back without a product (no eligible match) so the
  // Telegram message can flag exactly how many tiles need manual swap before
  // tomorrow's publish window opens.
  const filledSlots = await stories.listStorySlots({ plan_id: plan.id })
  const noProductCount = filledSlots.filter((s) => !s.product_id).length

  let renderResults
  try {
    renderResults = await batchRenderPlan(container, plan.id)
  } catch (err) {
    const msg = (err as Error)?.message ?? "batchRenderPlan failed"
    logger.error(`[auto-plan] batch render failed for plan ${plan.id}: ${msg}`)
    await sendTelegram(
      `⚠️ Auto-plan batch render failed for ${escapeTelegramHtml(planDate)}: ${escapeTelegramHtml(msg)}`,
    )
    return
  }

  const summary = summarizeBatch(renderResults)
  logger.info(
    `[auto-plan] ${planDate}: created plan ${plan.id}, rendered ${summary.ok}, skipped ${summary.skipped}, errors ${summary.error}, no-product slots ${noProductCount}`,
  )

  const lines = [
    `🎬 <b>Stories ready for ${escapeTelegramHtml(planDate)}</b>`,
    "",
    `✅ Rendered: ${summary.ok}`,
    summary.skipped > 0 ? `⏭ Skipped: ${summary.skipped}` : null,
    summary.error > 0 ? `❌ Errors: ${summary.error}` : null,
    noProductCount > 0
      ? `🛒 Need manual swap (no eligible product): ${noProductCount}`
      : null,
    "",
    `<a href="${ADMIN_URL}/stories/${planDate}">Open in admin</a>`,
  ].filter((l): l is string => l !== null)

  await sendTelegram(lines.join("\n"))
}

export const config = {
  name: "create-tomorrow-plan",
  // 14:00 UTC = 18:00 Mauritius (UTC+4, no DST). Daily.
  schedule: "0 14 * * *",
}
