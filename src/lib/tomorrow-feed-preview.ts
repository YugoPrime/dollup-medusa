import type { FeedPostDTO } from "../modules/feed-posts/service"
import type { FeedPreviewImage } from "./feed-preview"
import { type FeedPriceLabel, formatRs, productCode } from "./feed-price-label"
import { sortSizes } from "./feed-size-label"
import type { GridRowProblem } from "./grid-rotation"
import { escapeTelegramHtml, TELEGRAM_TEXT_MAX } from "./telegram"

/**
 * Wording of the 20:00 Telegram preview of tomorrow's grid post
 * (jobs/tomorrow-feed-preview.ts). Pure: the job works out what the 18:00 run
 * will do and sends; everything the owner reads is built here.
 */

/**
 * Where the owner changes the grid (dollup-admin). The page takes no date: it
 * opens on the current month with no day selected.
 */
export const FEED_PLANNER_URL = "https://admin.dollupboutique.com/feed-planner"

/** When daily-feed-post publishes (its 14:00 UTC run). */
const PUBLISH_TIME = "18:00"

/** Keeps the album caption far inside Telegram's 1024 characters, whatever the product. */
const NAME_MAX = 200
const SIZES_MAX = 200
const ERROR_MAX = 300

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Why tomorrow's product can't go out, as the owner reads it the evening before. */
const PROBLEM: Record<GridRowProblem, string> = {
  missing: "the product no longer exists",
  unpublished: "the product is no longer live",
  sold_out: "it is sold out",
  off_social: "it is kept off social",
  in_stories: "it is in tomorrow's stories",
  no_photos: "none of its reviewed photos is still on the product",
}

/** What the 18:00 run will do when it won't post tomorrow's planned row as it is. */
export type TomorrowNotice =
  /** META_* env vars missing: daily-feed-post can't publish at all. */
  | { kind: "meta_missing" }
  /** Nothing planned: 18:00 auto-picks, if a product can go out. */
  | { kind: "no_row" }
  | { kind: "posted"; row: FeedPostDTO }
  | { kind: "skipped"; row: FeedPostDTO }
  /** Failed FEED_MAX_ATTEMPTS times: not tried again. */
  | { kind: "gave_up"; row: FeedPostDTO }
  /** Planned, but its product can't go out: 18:00 swaps it for another. */
  | { kind: "replace"; row: FeedPostDTO; problem: GridRowProblem }
  /** Failed earlier and its product can't go out: 18:00 skips the day. */
  | { kind: "not_retried"; row: FeedPostDTO; problem: GridRowProblem }
  /** Failed earlier, product still fine: 18:00 tries it again. */
  | { kind: "retry"; row: FeedPostDTO }

/** A Mauritius date, "2026-11-27" → "Fri 27 Nov". */
export function formatMuDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`
}

/**
 * One price for the whole post, worded like the photos: "Rs 1,100"; "From
 * Rs 975" when a photo's sizes differ in price or the photos show different
 * prices; "Rs 770 (was Rs 1,100)" on sale. Null when no photo has a price.
 */
export function postPriceText(labels: Array<FeedPriceLabel | null | undefined>): string | null {
  const prices = labels.filter((p): p is FeedPriceLabel => p != null)
  if (prices.length === 0) return null
  const low = Math.min(...prices.map((p) => p.price_mur))
  if (prices.some((p) => p.from || p.price_mur !== low)) return `From ${formatRs(low)}`
  const was = prices[0].was_mur
  return was != null && prices.every((p) => p.was_mur === was)
    ? `${formatRs(low)} (was ${formatRs(was)})`
    : formatRs(low)
}

/**
 * Caption of the album: the day, then code, title, price and sizes as the
 * photos show them (summed up over the photos that could be drawn), and a
 * warning when some couldn't.
 */
export function albumCaption(args: {
  date: string
  snapshot: unknown
  images: FeedPreviewImage[]
}): string {
  const drawn = args.images.filter((i) => i.data_url != null)
  const shown = drawn.length > 0 ? drawn : args.images
  const sizes = sortSizes(shown.flatMap((i) => i.sizes))
  const details = [
    productLine(args.snapshot),
    postPriceText(shown.map((i) => i.price)),
    sizes.length > 0 ? escapeTelegramHtml(clip(sizes.join(" "), SIZES_MAX)) : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ")

  const lines = [`📅 Tomorrow's grid post · ${formatMuDay(args.date)}, ${PUBLISH_TIME}`, details]
  const missing = args.images.length - drawn.length
  if (args.images.length === 0) {
    lines.push(`⚠️ No photo to post, so the post may fail at ${PUBLISH_TIME}`)
  } else if (drawn.length === 0) {
    lines.push(
      args.images.length === 1
        ? `⚠️ The photo couldn't be drawn, so the post may fail at ${PUBLISH_TIME}`
        : `⚠️ None of the ${args.images.length} photos could be drawn, so the post may fail at ${PUBLISH_TIME}`,
    )
  } else if (missing > 0) {
    lines.push(`⚠️ ${missing} photo${missing === 1 ? "" : "s"} couldn't be drawn`)
  }
  return lines.join("\n")
}

const PLANNER_LINK_LABEL = "Change it in the Feed Planner"
const PLANNER_LINK_NOTE = " (Replace / Keep off social)"

/**
 * The post's caption exactly as it will go out (escaped, cut to fit one
 * message), then where to change the post.
 */
export function postCaptionMessage(caption: string | null): string {
  const link = `✏️ <a href="${FEED_PLANNER_URL}">${PLANNER_LINK_LABEL}</a>${PLANNER_LINK_NOTE}`
  const text = (caption ?? "").trim()
  if (!text) return `<i>No caption</i>\n\n${link}`
  // Telegram counts the parsed text, where the link line is just its label and note.
  const room = TELEGRAM_TEXT_MAX - `✏️ ${PLANNER_LINK_LABEL}${PLANNER_LINK_NOTE}`.length - 2
  return `${escapeTelegramHtml(clip(text, room))}\n\n${link}`
}

/** One short text instead of the album: what the 18:00 run will do. */
export function noticeMessage(date: string, notice: TomorrowNotice): string {
  const head = (emoji: string, title: string) => `${emoji} <b>${title}</b> · ${formatMuDay(date)}`
  const choose = `✏️ <a href="${FEED_PLANNER_URL}">Choose one in the Feed Planner</a>`
  const product = (row: FeedPostDTO) => productLine(row.product_snapshot, row.product_id)
  let lines: Array<string | null>
  switch (notice.kind) {
    case "meta_missing":
      lines = [
        head("⚠️", "Tomorrow's grid post can't go out"),
        "",
        `Instagram isn't connected on the server (META_PAGE_ACCESS_TOKEN or META_IG_BUSINESS_ACCOUNT_ID is missing), so nothing posts at ${PUBLISH_TIME}.`,
      ]
      break
    case "no_row":
      lines = [
        head("🟡", "No grid post planned for tomorrow"),
        "",
        `At ${PUBLISH_TIME} one will be picked automatically, if a product can go out.`,
        choose,
      ]
      break
    case "posted":
      lines = [
        head("✅", "Tomorrow's grid post is already up"),
        "",
        product(notice.row),
        `Nothing else posts at ${PUBLISH_TIME}.`,
      ]
      break
    case "skipped":
      lines = [
        head("⏭️", "No grid post tomorrow"),
        "",
        `The day is marked as skipped, so nothing posts at ${PUBLISH_TIME}.`,
      ]
      break
    case "gave_up":
      lines = [
        head("🟠", "No grid post tomorrow"),
        "",
        `${product(notice.row)} failed ${notice.row.attempt_count} times, so it won't be tried again.`,
      ]
      break
    case "replace":
      lines = [
        head("🔁", "Tomorrow's grid post will be swapped"),
        "",
        `${product(notice.row)}: ${PROBLEM[notice.problem]}.`,
        `At ${PUBLISH_TIME} another product will be picked instead, if one can go out.`,
        choose,
      ]
      break
    case "not_retried":
      lines = [
        head("🟠", "No grid post tomorrow"),
        "",
        `${product(notice.row)} failed earlier and won't be tried again: ${PROBLEM[notice.problem]}.`,
      ]
      break
    case "retry":
      lines = [
        head("🟠", "Tomorrow's grid post failed on an earlier try"),
        "",
        product(notice.row),
        notice.row.error ? `Error: ${escapeTelegramHtml(clip(notice.row.error, ERROR_MAX))}` : null,
        `At ${PUBLISH_TIME} it will be tried again.`,
      ]
      break
  }
  return lines.filter((l): l is string => l !== null).join("\n")
}

/** The alert when building the preview crashed (text from alertOnThrow). */
export function previewFailedMessage(text: string): string {
  return [
    `⚠️ <b>${escapeTelegramHtml(clip(text, 1000))}</b>`,
    "",
    `This doesn't stop the ${PUBLISH_TIME} post.`,
    `✏️ <a href="${FEED_PLANNER_URL}">Check it in the Feed Planner</a>`,
  ].join("\n")
}

/** A preview image's `data:image/jpeg;base64,…` back to the JPEG bytes Telegram uploads. */
export function jpegFromDataUrl(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64")
}

/** "<b>IS2571</b> · Satin Slip Dress": the code customers quote, then the title. */
function productLine(snapshot: unknown, fallbackName?: string | null): string {
  const code = productCode(snapshot as Parameters<typeof productCode>[0])
  const title = String((snapshot as { name?: unknown } | null)?.name ?? "").trim()
  const name = clip(title || fallbackName || "the planned product", NAME_MAX)
  return [code ? `<b>${escapeTelegramHtml(code)}</b>` : null, escapeTelegramHtml(name)]
    .filter((part): part is string => part !== null)
    .join(" · ")
}

/** At most `max` UTF-16 units, ending in "…" when cut; never cuts an emoji in half. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  let cut = text.slice(0, max - 1)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return `${cut}…`
}
