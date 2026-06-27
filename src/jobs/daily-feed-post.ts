import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { mauritiusToday } from "../lib/mauritius-date"
import {
  buildFeedPostForDate,
  publishFeedPostRow,
} from "../lib/feed-post-pipeline"
import { isMetaIgConfigured } from "../lib/meta-ig"
import { escapeTelegramHtml, sendTelegram } from "../lib/telegram"
import { FEED_POSTS_MODULE } from "../modules/feed-posts"
import type FeedPostsModuleService from "../modules/feed-posts/service"
import { decideDailyPublishAction } from "../lib/feed-planner"

const ADMIN_URL = process.env.ADMIN_URL ?? "https://api.dollupboutique.com/app"
const DEFAULT_DEDUP_DAYS = 30

/**
 * Daily IG/FB feed post — one product per day, posted at 18:00 Mauritius.
 * A pre-planned row from the Feed Planner is published as-is; an empty day is
 * auto-picked (newest-collection weighting + dedup); a posted/skipped day is
 * left alone. Uses the product's own photos (carousel), not a story template.
 *
 * Kill-switch: FEED_AUTO_PUBLISH must be "true".
 */
export default async function dailyFeedPost(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  if (process.env.FEED_AUTO_PUBLISH !== "true") {
    return // dormant; toggle FEED_AUTO_PUBLISH=true in Coolify when ready
  }
  if (!isMetaIgConfigured()) {
    logger.warn(
      "[feed-post] META_PAGE_ACCESS_TOKEN or META_IG_BUSINESS_ACCOUNT_ID missing — cannot publish",
    )
    return
  }

  const postDate = mauritiusToday()
  const dedupDays = Number(process.env.FEED_DEDUP_DAYS) || DEFAULT_DEDUP_DAYS

  const feed = container.resolve<FeedPostsModuleService>(FEED_POSTS_MODULE)
  const existing = await feed.findByDate(postDate)
  const action = decideDailyPublishAction(existing)

  if (action === "skip") {
    logger.info(
      `[feed-post] ${postDate}: ${existing?.status} row already exists — skipping`,
    )
    return
  }

  let feedPostId: string
  let name: string
  let imageCount: number

  if (action === "publish_existing" && existing) {
    feedPostId = existing.id
    const snap = (existing.product_snapshot ?? {}) as { name?: string }
    name = snap.name ?? existing.product_id ?? "(unknown)"
    imageCount = (existing.image_urls as string[] | null)?.length ?? 0
  } else {
    let built
    try {
      built = await buildFeedPostForDate({ scope: container, postDate, dedupDays })
    } catch (err) {
      const msg = (err as Error)?.message ?? "buildFeedPostForDate failed"
      logger.error(`[feed-post] build failed for ${postDate}: ${msg}`)
      await sendTelegram(
        `⚠️ Daily feed post build failed for ${escapeTelegramHtml(postDate)}: ${escapeTelegramHtml(msg)}`,
      )
      return
    }
    if (!built.ok) {
      if (built.reason === "exists") {
        logger.info(`[feed-post] ${postDate} already has a feed post — skipping`)
        return
      }
      const reason =
        built.reason === "no_images"
          ? "picked product has no usable feed photo"
          : "no eligible product to feature"
      logger.warn(`[feed-post] ${postDate}: ${reason}`)
      await sendTelegram(
        `🟡 <b>No feed post for ${escapeTelegramHtml(postDate)}</b>\n\n${escapeTelegramHtml(reason)}.`,
      )
      return
    }
    feedPostId = built.row.id
    const snap = (built.row.product_snapshot ?? {}) as { name?: string }
    name = snap.name ?? built.product_id
    imageCount = built.row.image_urls.length
  }

  const result = await publishFeedPostRow({ scope: container, feedPostId })

  if (result.ok) {
    logger.info(
      `[feed-post] ${postDate}: published "${name}" → IG ${result.ig_media_id}${result.fb_post_id ? ` / FB ${result.fb_post_id}` : ""}`,
    )
    await sendTelegram(
      [
        `🛍️ <b>Feed post published — ${escapeTelegramHtml(postDate)}</b>`,
        "",
        `📦 ${escapeTelegramHtml(name)}`,
        `🖼️ ${imageCount} photo(s)`,
        `📷 IG: ${escapeTelegramHtml(result.ig_media_id ?? "")}`,
        result.fb_post_id ? `📘 FB: ${escapeTelegramHtml(result.fb_post_id)}` : null,
      ]
        .filter((l): l is string => l !== null)
        .join("\n"),
    )
    return
  }

  logger.error(`[feed-post] ${postDate}: publish failed: ${result.error}`)
  await sendTelegram(
    [
      `❌ <b>Feed post failed — ${escapeTelegramHtml(postDate)}</b>`,
      "",
      `📦 ${escapeTelegramHtml(name)}`,
      `Error: ${escapeTelegramHtml(result.error ?? "unknown")}`,
      "",
      `Retry from <a href="${ADMIN_URL}">admin</a> (POST /admin/feed-posts).`,
    ].join("\n"),
  )
}

export const config = {
  name: "daily-feed-post",
  // 14:00 UTC = 18:00 Mauritius (UTC+4, no DST). Daily.
  schedule: "0 14 * * *",
}
