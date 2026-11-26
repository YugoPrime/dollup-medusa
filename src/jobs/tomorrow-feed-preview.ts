import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { decideDailyPublishAction } from "../lib/feed-planner"
import { previewFeedRow } from "../lib/feed-row-preview"
import { inspectGridRow } from "../lib/grid-planner"
import { stepAfterInspection } from "../lib/grid-rotation"
import { alertOnThrow } from "../lib/job-safety"
import { mauritiusTomorrow } from "../lib/mauritius-date"
import { isMetaIgConfigured } from "../lib/meta-ig"
import { sendTelegram, sendTelegramPhotos, type TelegramSendResult } from "../lib/telegram"
import {
  albumCaption,
  jpegFromDataUrl,
  noticeMessage,
  postCaptionMessage,
  previewFailedMessage,
  type TomorrowNotice,
} from "../lib/tomorrow-feed-preview"
import { FEED_POSTS_MODULE } from "../modules/feed-posts"
import type FeedPostsModuleService from "../modules/feed-posts/service"
import type { FeedPostDTO } from "../modules/feed-posts/service"

type Logger = { info(m: string): void; warn(m: string): void; error(m: string): void }

/**
 * Tomorrow's grid post on Telegram at 20:00 Mauritius, as it will go out at
 * 18:00. Rahvi, 2026-11-26: "Possible i get via telegram what will be the next
 * day feed product post?"
 *
 * 1. An album of the photos drawn exactly as the publish draws them (price,
 *    code and sizes on each), captioned with the day and the product line.
 * 2. The caption that will go out, and a link to change the post in the Feed
 *    Planner.
 *
 * Read only: it plans, replaces and posts nothing. It works out what
 * daily-feed-post will do with the same functions (decideDailyPublishAction,
 * inspectGridRow against tomorrow's stories, stepAfterInspection), so when
 * tomorrow can't go out as planned (nothing planned, already posted or
 * skipped, a failed row, a product problem, Instagram not connected) one short
 * text says what the 18:00 run will do instead. Price and stock are read now;
 * the 18:00 run reads them again.
 *
 * Silent when FEED_AUTO_PUBLISH isn't "true": nothing posts then. A crash
 * becomes one Telegram alert; a Telegram failure is logged, never thrown.
 * Text and wording: src/lib/tomorrow-feed-preview.ts.
 */
export default async function tomorrowFeedPreview(container: MedusaContainer): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger
  const date = mauritiusTomorrow()

  if (process.env.FEED_AUTO_PUBLISH !== "true") {
    logger.info(
      `[feed-tg-preview] ${date}: FEED_AUTO_PUBLISH is not "true", nothing posts at 18:00, no preview`,
    )
    return
  }

  await alertOnThrow(
    "Tomorrow's grid post preview",
    () => sendPreview(container, date, logger),
    async (text) => {
      logger.error(`[feed-tg-preview] ${date}: ${text}`)
      logSend(logger, `${date} alert`, await sendTelegram(previewFailedMessage(text)))
    },
  )
}

async function sendPreview(scope: MedusaContainer, date: string, logger: Logger): Promise<void> {
  const tomorrow = await whatPostsTomorrow(scope, date)
  if (tomorrow.kind !== "post") {
    logger.info(`[feed-tg-preview] ${date}: ${tomorrow.kind}, sending a short notice instead of the photos`)
    logSend(logger, `${date} notice`, await sendTelegram(noticeMessage(date, tomorrow)))
    return
  }

  const preview = await previewFeedRow(scope, tomorrow.row)
  const drawn = preview.images.filter((i) => i.data_url != null)
  const caption = albumCaption({ date, snapshot: preview.product_snapshot, images: preview.images })
  logSend(
    logger,
    `${date} photos`,
    drawn.length > 0
      ? await sendTelegramPhotos(drawn.map((i) => jpegFromDataUrl(i.data_url as string)), { caption })
      : await sendTelegram(caption),
  )
  logSend(logger, `${date} caption`, await sendTelegram(postCaptionMessage(preview.caption)))

  const name = (preview.product_snapshot as { name?: string } | null)?.name ?? tomorrow.row.product_id
  logger.info(
    `[feed-tg-preview] ${date}: preview of "${name}", ${drawn.length} of ${preview.images.length} photo(s) drawn`,
  )
}

/** What the 18:00 run will do with tomorrow's row, worked out the way daily-feed-post does it. */
async function whatPostsTomorrow(
  scope: MedusaContainer,
  date: string,
): Promise<TomorrowNotice | { kind: "post"; row: FeedPostDTO }> {
  if (!isMetaIgConfigured()) return { kind: "meta_missing" }

  const feed = scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const row = await feed.findByDate(date)
  const action = decideDailyPublishAction(row)
  if (!row || action === "auto_pick") return { kind: "no_row" }
  if (action === "skip") {
    if (row.status === "posted") return { kind: "posted", row }
    if (row.status === "skipped") return { kind: "skipped", row }
    return { kind: "gave_up", row }
  }

  // A planned row, or a failed one with tries left: checked like at 18:00.
  const { problem } = await inspectGridRow(scope, row, date)
  const step = stepAfterInspection(row.status as "planned" | "failed", problem)
  if (step === "replace" && problem) return { kind: "replace", row, problem }
  if (step === "skip_with_alert" && problem) return { kind: "not_retried", row, problem }
  return row.status === "failed" ? { kind: "retry", row } : { kind: "post", row }
}

/** Telegram never throws here: a send that didn't go out is only logged. */
function logSend(logger: Logger, what: string, result: TelegramSendResult): void {
  if (result.ok) return
  if ("skipped" in result) {
    logger.info(`[feed-tg-preview] ${what} not sent: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set`)
    return
  }
  logger.error(`[feed-tg-preview] ${what} not sent (${result.status}): ${result.message}`)
}

export const config = {
  name: "tomorrow-feed-preview",
  // 16:00 UTC = 20:00 Mauritius (UTC+4, no DST), daily: after the 18:00 runs
  // have planned the week ahead and made tomorrow's stories, which the
  // product check reads.
  schedule: "0 16 * * *",
}
