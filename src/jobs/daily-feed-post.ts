import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { mauritiusToday } from "../lib/mauritius-date"
import { publishFeedPostRow } from "../lib/feed-post-pipeline"
import { decideDailyPublishAction, FEED_MAX_ATTEMPTS } from "../lib/feed-planner"
import {
  planGridPostForDate,
  plannedRowProblem,
  planUpcomingGridPosts,
} from "../lib/grid-planner"
import type { GridRowProblem } from "../lib/grid-rotation"
import { isMetaIgConfigured } from "../lib/meta-ig"
import { escapeTelegramHtml, sendTelegram } from "../lib/telegram"
import { FEED_POSTS_MODULE } from "../modules/feed-posts"
import type FeedPostsModuleService from "../modules/feed-posts/service"
import type { FeedPostDTO } from "../modules/feed-posts/service"
import { STORIES_MODULE } from "../modules/stories"
import type StoriesModuleService from "../modules/stories/service"

/** The owner reviews and fixes grid posts here (dollup-admin, not Medusa /app). */
const FEED_PLANNER_URL = "https://admin.dollupboutique.com/feed-planner"

const PROBLEM_LABEL: Record<GridRowProblem, string> = {
  missing: "the product no longer exists",
  unpublished: "the product is no longer live",
  sold_out: "it sold out",
  off_social: "it was switched off social",
  in_stories: "it is in today's stories",
}

type Logger = { info(m: string): void; warn(m: string): void; error(m: string): void }

/**
 * Daily IG/FB grid post, 18:00 Mauritius, with retries at 18:20 and 18:40.
 *
 * 1. Publish (FEED_AUTO_PUBLISH=true): today's planned row is re-checked
 *    first (sold out, switched off social, now in today's stories → replaced
 *    in the same rotation); an empty day is auto-picked; a failed row is
 *    retried until FEED_MAX_ATTEMPTS, then the owner gets a Telegram alert.
 * 2. Top up: keeps the next 7 days planned so the owner can review them in the
 *    Feed Planner. Runs when auto-publish is on or a focus tag is set, so the
 *    calendar never fills with older stock before the collection is live.
 */
export default async function dailyFeedPost(container: MedusaContainer): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger
  const stories = container.resolve<StoriesModuleService>(STORIES_MODULE)
  const settings = await stories.getSettings()
  const today = mauritiusToday()
  const autoPublish = process.env.FEED_AUTO_PUBLISH === "true"
  // Only the 18:00 run sends "nothing to post" alerts; the retry runs stay quiet.
  const firstRun = new Date().getUTCMinutes() < 10

  if (autoPublish) {
    if (!isMetaIgConfigured()) {
      logger.warn(
        "[feed-post] META_PAGE_ACCESS_TOKEN or META_IG_BUSINESS_ACCOUNT_ID missing — cannot publish",
      )
    } else {
      await publishToday(container, today, firstRun, logger)
    }
  }

  if (autoPublish || Boolean((settings.focus_tag ?? "").trim())) {
    try {
      const { planned, empty } = await planUpcomingGridPosts({ scope: container, today })
      logger.info(
        `[feed-post] planning: ${planned.length} day(s) planned${empty.length ? `, nothing for ${empty.join(", ")}` : ""}`,
      )
      if (firstRun && empty.length > 0) {
        await sendTelegram(
          [
            `🟡 <b>No grid post could be planned for ${escapeTelegramHtml(empty.join(", "))}</b>`,
            "",
            "No eligible product in any of the 3 categories.",
            "",
            `<a href="${FEED_PLANNER_URL}">Open the Feed Planner</a>`,
          ].join("\n"),
        )
      }
    } catch (err) {
      logger.error(`[feed-post] planning failed: ${(err as Error)?.message ?? err}`)
    }
  }
}

async function publishToday(
  scope: MedusaContainer,
  today: string,
  firstRun: boolean,
  logger: Logger,
): Promise<void> {
  const feed = scope.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  let row: FeedPostDTO | null = await feed.findByDate(today)
  const action = decideDailyPublishAction(row)

  if (action === "skip") {
    logger.info(`[feed-post] ${today}: ${row?.status} row (attempts ${row?.attempt_count ?? 0}) — skipping`)
    return
  }

  if (action === "auto_pick" || !row) {
    const picked = await planGridPostForDate({ scope, postDate: today })
    if (!picked.ok) {
      logger.warn(`[feed-post] ${today}: nothing to post (${picked.reason})`)
      if (firstRun) {
        await sendTelegram(
          `🟡 <b>No feed post for ${escapeTelegramHtml(today)}</b>\n\nNo eligible product in any of the 3 categories.`,
        )
      }
      return
    }
    row = picked.row
  } else if (row.status === "planned") {
    const problem = await plannedRowProblem(scope, row, today)
    if (problem) {
      const oldName = snapshotName(row)
      await feed.deletePlannedByDate(today)
      const replaced = await planGridPostForDate({
        scope,
        postDate: today,
        excludeProductIds: row.product_id ? [row.product_id] : [],
      })
      await sendTelegram(
        [
          `🔁 <b>Today's grid post was replaced</b>`,
          "",
          `${escapeTelegramHtml(oldName)}: ${PROBLEM_LABEL[problem]}.`,
          replaced.ok
            ? `Posting instead: ${escapeTelegramHtml(snapshotName(replaced.row))}`
            : "No replacement available — nothing posts today.",
        ].join("\n"),
      )
      if (!replaced.ok) return
      row = replaced.row
    }
  }

  const name = snapshotName(row)
  const result = await publishFeedPostRow({ scope, feedPostId: row.id })

  if (result.ok) {
    logger.info(
      `[feed-post] ${today}: published "${name}" → IG ${result.ig_media_id}${result.fb_post_id ? ` / FB ${result.fb_post_id}` : ""}`,
    )
    await sendTelegram(
      [
        `🛍️ <b>Feed post published — ${escapeTelegramHtml(today)}</b>`,
        "",
        `📦 ${escapeTelegramHtml(name)}`,
        `🖼️ ${row.image_urls.length} photo(s)`,
        `📷 IG: ${escapeTelegramHtml(result.ig_media_id ?? "")}`,
        result.fb_post_id ? `📘 FB: ${escapeTelegramHtml(result.fb_post_id)}` : null,
      ]
        .filter((l): l is string => l !== null)
        .join("\n"),
    )
    return
  }

  logger.error(
    `[feed-post] ${today}: publish failed (attempt ${result.attempt_count ?? "?"}): ${result.error}`,
  )
  if (result.attempt_count === FEED_MAX_ATTEMPTS) {
    await sendTelegram(
      [
        `❌ <b>Feed post failed ${FEED_MAX_ATTEMPTS} times — ${escapeTelegramHtml(today)}</b>`,
        "",
        `📦 ${escapeTelegramHtml(name)}`,
        `Error: ${escapeTelegramHtml(result.error ?? "unknown")}`,
        "",
        `Nothing posted today. <a href="${FEED_PLANNER_URL}">Open the Feed Planner</a>`,
      ].join("\n"),
    )
  }
}

function snapshotName(row: FeedPostDTO): string {
  const snap = (row.product_snapshot ?? {}) as { name?: string }
  return snap.name ?? row.product_id ?? "(unknown)"
}

export const config = {
  name: "daily-feed-post",
  // 14:00/14:20/14:40 UTC = 18:00/18:20/18:40 Mauritius (UTC+4, no DST):
  // the post at 18:00, two retry windows for a failed publish.
  schedule: "0,20,40 14 * * *",
}
