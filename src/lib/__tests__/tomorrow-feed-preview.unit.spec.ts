import type { FeedPreviewImage } from "../feed-preview"
import { buildFeedCaption } from "../feed-post-content"
import type { FeedPostDTO } from "../../modules/feed-posts/service"
import { buildSnapshot } from "../../modules/stories/snapshot"
import {
  albumCaption,
  FEED_PLANNER_URL,
  formatMuDay,
  jpegFromDataUrl,
  noticeMessage,
  postCaptionMessage,
  postPriceText,
  previewFailedMessage,
  type TomorrowNotice,
} from "../tomorrow-feed-preview"
import { BACK, FRONT, IS2571_PRODUCT, PLANNED_ROW } from "./fixtures/is2571"

const DATE = "2026-11-27"
const LINK = `✏️ <a href="https://admin.dollupboutique.com/feed-planner">Change it in the Feed Planner</a> (Replace / Keep off social)`

const image = (over: Partial<FeedPreviewImage> = {}): FeedPreviewImage => ({
  source_url: FRONT,
  sizes: ["S", "M", "L"],
  price: { price_mur: 1100, from: false, was_mur: null },
  sku: "IS2571",
  data_url: "data:image/jpeg;base64,AAAA",
  ...over,
})
const failed = (over: Partial<FeedPreviewImage> = {}) => image({ data_url: null, error: "HTTP 404", ...over })
const snapshot = { name: "Satin Slip Dress", handle: "is2571" }

/** What Telegram counts: the text once tags are gone and entities are one character. */
function visible(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
}

describe("formatMuDay", () => {
  it("writes a Mauritius date as weekday, day and month", () => {
    expect(formatMuDay("2026-11-27")).toBe("Fri 27 Nov")
    expect(formatMuDay("2026-12-01")).toBe("Tue 1 Dec")
    expect(formatMuDay("2027-01-01")).toBe("Fri 1 Jan")
  })
})

describe("postPriceText", () => {
  it("reads like the photos: one price, with the thousands comma", () => {
    expect(postPriceText([image().price, image().price])).toBe("Rs 1,100")
    expect(postPriceText([{ price_mur: 12500, from: false, was_mur: null }])).toBe("Rs 12,500")
  })

  it('says "From" when the sizes on a photo differ in price', () => {
    expect(postPriceText([{ price_mur: 975, from: true, was_mur: null }])).toBe("From Rs 975")
  })

  it('says "From" the lowest when the photos show different prices', () => {
    expect(
      postPriceText([
        { price_mur: 1050, from: false, was_mur: null },
        { price_mur: 975, from: false, was_mur: null },
      ]),
    ).toBe("From Rs 975")
  })

  it("shows the sale price with the old one", () => {
    const sale = { price_mur: 770, from: false, was_mur: 1100 }
    expect(postPriceText([sale, sale])).toBe("Rs 770 (was Rs 1,100)")
    // Only one colour on sale at the same price: no single "was" to quote.
    expect(postPriceText([sale, { price_mur: 770, from: false, was_mur: null }])).toBe("Rs 770")
  })

  it("is null when no photo has a price", () => {
    expect(postPriceText([null, null])).toBeNull()
    expect(postPriceText([])).toBeNull()
  })
})

describe("albumCaption", () => {
  it("is the day, then code, title, price and sizes (Fri 27 Nov fixture)", () => {
    expect(albumCaption({ date: DATE, snapshot, images: [image(), image({ source_url: BACK })] })).toBe(
      "📅 Tomorrow's grid post · Fri 27 Nov, 18:00\n<b>IS2571</b> · Satin Slip Dress · Rs 1,100 · S M L",
    )
  })

  it("matches the price on the photos: From and sale wording", () => {
    const from = albumCaption({ date: DATE, snapshot, images: [image({ price: { price_mur: 975, from: true, was_mur: null } })] })
    expect(from.split("\n")[1]).toBe("<b>IS2571</b> · Satin Slip Dress · From Rs 975 · S M L")
    const sale = albumCaption({ date: DATE, snapshot, images: [image({ price: { price_mur: 770, from: false, was_mur: 1100 } })] })
    expect(sale.split("\n")[1]).toBe("<b>IS2571</b> · Satin Slip Dress · Rs 770 (was Rs 1,100) · S M L")
  })

  it("says how many photos couldn't be drawn, and sums up only the ones that did", () => {
    const one = albumCaption({
      date: DATE,
      snapshot,
      images: [image({ sizes: ["M", "S"] }), failed({ sizes: ["L"], price: { price_mur: 1250, from: false, was_mur: null } })],
    })
    expect(one).toBe(
      "📅 Tomorrow's grid post · Fri 27 Nov, 18:00\n<b>IS2571</b> · Satin Slip Dress · Rs 1,100 · S M\n⚠️ 1 photo couldn't be drawn",
    )
    const two = albumCaption({ date: DATE, snapshot, images: [image(), failed(), failed()] })
    expect(two.split("\n")[2]).toBe("⚠️ 2 photos couldn't be drawn")
  })

  it("warns that the post may fail when no photo could be drawn", () => {
    expect(albumCaption({ date: DATE, snapshot, images: [failed(), failed()] })).toBe(
      "📅 Tomorrow's grid post · Fri 27 Nov, 18:00\n<b>IS2571</b> · Satin Slip Dress · Rs 1,100 · S M L\n⚠️ None of the 2 photos could be drawn, so the post may fail at 18:00",
    )
    expect(albumCaption({ date: DATE, snapshot, images: [failed()] }).split("\n")[2]).toBe(
      "⚠️ The photo couldn't be drawn, so the post may fail at 18:00",
    )
  })

  it("escapes the title and leaves out what the product doesn't have", () => {
    const caption = albumCaption({
      date: DATE,
      snapshot: { name: "Bow & Lace <Midi>", handle: "bow-lace-midi" },
      images: [image({ sizes: [], price: null, sku: null })],
    })
    expect(caption.split("\n")[1]).toBe("Bow &amp; Lace &lt;Midi&gt;")
  })

  it("stays inside Telegram's 1024-character caption limit with a very long title", () => {
    const caption = albumCaption({ date: DATE, snapshot: { name: "Dress ".repeat(400), handle: "is2571" }, images: [image(), failed()] })
    expect(visible(caption).length).toBeLessThanOrEqual(1024)
    expect(caption).toContain("…")
    expect(caption).toContain("⚠️ 1 photo couldn't be drawn")
  })
})

describe("postCaptionMessage", () => {
  it("is the caption exactly as it will go out, then the Feed Planner link (Fri 27 Nov fixture)", () => {
    const caption = buildFeedCaption(buildSnapshot(IS2571_PRODUCT), {})
    expect(postCaptionMessage(caption)).toBe(
      [
        "Satin Slip Dress",
        "",
        "💰 Rs 1,100",
        "🏷️ Ref: IS2571",
        "📏 Sizes: S · M · L",
        "🎨 Colours: Black",
        "",
        "📲 DM us or comment to order",
        "🚚 Fast island-wide delivery",
        "🔗 https://dollupboutique.com/products/is2571",
        "",
        "#dollupboutique #mauritius #shopmauritius #fashionmauritius #moris",
        "",
        LINK,
      ].join("\n"),
    )
  })

  it("escapes the caption for Telegram's HTML", () => {
    expect(postCaptionMessage("Love it <3 & more")).toBe(`Love it &lt;3 &amp; more\n\n${LINK}`)
  })

  it("cuts a caption past Telegram's 4096 limit, never through an emoji, and keeps the link", () => {
    // 4028 + 2 per emoji: the cut at 4033 lands between the halves of an emoji.
    const message = postCaptionMessage(`${"a".repeat(4028)}${"😍".repeat(100)}`)
    expect(visible(message).length).toBeLessThanOrEqual(4096)
    expect(message.endsWith(LINK)).toBe(true)
    const kept = message.slice(0, message.indexOf("\n\n✏️"))
    expect(kept.endsWith("…")).toBe(true)
    // No half emoji (lone surrogate) before the ellipsis.
    const last = kept.charCodeAt(kept.length - 2)
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
  })

  it("says so when the post has no caption", () => {
    expect(postCaptionMessage(null)).toBe(`<i>No caption</i>\n\n${LINK}`)
    expect(postCaptionMessage("  ")).toBe(`<i>No caption</i>\n\n${LINK}`)
  })
})

describe("noticeMessage", () => {
  const row = (over: Partial<FeedPostDTO> = {}): FeedPostDTO => ({ ...PLANNED_ROW, ...over })

  it("no row: the 18:00 run picks one if it can", () => {
    expect(noticeMessage(DATE, { kind: "no_row" })).toBe(
      [
        "🟡 <b>No grid post planned for tomorrow</b> · Fri 27 Nov",
        "",
        "At 18:00 one will be picked automatically, if a product can go out.",
        `✏️ <a href="${FEED_PLANNER_URL}">Choose one in the Feed Planner</a>`,
      ].join("\n"),
    )
  })

  it("a planned product that can't go out is swapped at 18:00", () => {
    expect(noticeMessage(DATE, { kind: "replace", row: row(), problem: "sold_out" })).toBe(
      [
        "🔁 <b>Tomorrow's grid post will be swapped</b> · Fri 27 Nov",
        "",
        "<b>IS2571</b> · Satin Slip Dress: it is sold out.",
        "At 18:00 another product will be picked instead, if one can go out.",
        `✏️ <a href="${FEED_PLANNER_URL}">Choose one in the Feed Planner</a>`,
      ].join("\n"),
    )
    expect(noticeMessage(DATE, { kind: "replace", row: row(), problem: "in_stories" })).toContain(
      "Satin Slip Dress: it is in tomorrow's stories.",
    )
    expect(noticeMessage(DATE, { kind: "replace", row: row(), problem: "off_social" })).toContain(
      "Satin Slip Dress: it is kept off social.",
    )
  })

  it("already posted, skipped, or given up: nothing posts at 18:00", () => {
    expect(noticeMessage(DATE, { kind: "posted", row: row({ status: "posted" }) })).toBe(
      [
        "✅ <b>Tomorrow's grid post is already up</b> · Fri 27 Nov",
        "",
        "<b>IS2571</b> · Satin Slip Dress",
        "Nothing else posts at 18:00.",
      ].join("\n"),
    )
    expect(noticeMessage(DATE, { kind: "skipped", row: row({ status: "skipped" }) })).toBe(
      [
        "⏭️ <b>No grid post tomorrow</b> · Fri 27 Nov",
        "",
        "The day is marked as skipped, so nothing posts at 18:00.",
      ].join("\n"),
    )
    expect(noticeMessage(DATE, { kind: "gave_up", row: row({ status: "failed", attempt_count: 3 }) })).toBe(
      [
        "🟠 <b>No grid post tomorrow</b> · Fri 27 Nov",
        "",
        "<b>IS2571</b> · Satin Slip Dress failed 3 times, so it won't be tried again.",
      ].join("\n"),
    )
  })

  it("a failed row: retried at 18:00, unless its product can't go out", () => {
    expect(
      noticeMessage(DATE, { kind: "retry", row: row({ status: "failed", attempt_count: 1, error: "IG <timeout>" }) }),
    ).toBe(
      [
        "🟠 <b>Tomorrow's grid post failed on an earlier try</b> · Fri 27 Nov",
        "",
        "<b>IS2571</b> · Satin Slip Dress",
        "Error: IG &lt;timeout&gt;",
        "At 18:00 it will be tried again.",
      ].join("\n"),
    )
    expect(noticeMessage(DATE, { kind: "not_retried", row: row({ status: "failed" }), problem: "unpublished" })).toBe(
      [
        "🟠 <b>No grid post tomorrow</b> · Fri 27 Nov",
        "",
        "<b>IS2571</b> · Satin Slip Dress failed earlier and won't be tried again: the product is no longer live.",
      ].join("\n"),
    )
  })

  it("Instagram not connected: nothing can post", () => {
    expect(noticeMessage(DATE, { kind: "meta_missing" })).toBe(
      [
        "⚠️ <b>Tomorrow's grid post can't go out</b> · Fri 27 Nov",
        "",
        "Instagram isn't connected on the server (META_PAGE_ACCESS_TOKEN or META_IG_BUSINESS_ACCOUNT_ID is missing), so nothing posts at 18:00.",
      ].join("\n"),
    )
  })

  it("escapes the product name and falls back to the product id", () => {
    const named = row({ product_snapshot: { name: "Bow & Lace", handle: "bow-lace" } })
    expect(noticeMessage(DATE, { kind: "posted", row: named })).toContain("\nBow &amp; Lace\n")
    const unnamed = row({ product_snapshot: null, product_id: "prod_123" })
    expect(noticeMessage(DATE, { kind: "replace", row: unnamed, problem: "missing" })).toContain(
      "prod_123: the product no longer exists.",
    )
  })
})

describe("previewFailedMessage", () => {
  it("names the failure and says the 18:00 post isn't affected", () => {
    expect(previewFailedMessage("Tomorrow's grid post preview failed: <db> down")).toBe(
      [
        "⚠️ <b>Tomorrow's grid post preview failed: &lt;db&gt; down</b>",
        "",
        "This doesn't stop the 18:00 post.",
        `✏️ <a href="${FEED_PLANNER_URL}">Check it in the Feed Planner</a>`,
      ].join("\n"),
    )
  })
})

describe("jpegFromDataUrl", () => {
  it("turns a preview data URL back into the JPEG bytes", () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9])
    expect(jpegFromDataUrl(`data:image/jpeg;base64,${bytes.toString("base64")}`)).toEqual(bytes)
  })
})

describe("copy", () => {
  it("has no em or en dashes in any message", () => {
    const notices: TomorrowNotice[] = [
      { kind: "meta_missing" },
      { kind: "no_row" },
      { kind: "posted", row: PLANNED_ROW },
      { kind: "skipped", row: PLANNED_ROW },
      { kind: "gave_up", row: PLANNED_ROW },
      ...(["missing", "unpublished", "sold_out", "off_social", "in_stories", "no_photos"] as const).flatMap((problem) => [
        { kind: "replace" as const, row: PLANNED_ROW, problem },
        { kind: "not_retried" as const, row: PLANNED_ROW, problem },
      ]),
      { kind: "retry", row: { ...PLANNED_ROW, error: "x" } },
    ]
    const all = [
      ...notices.map((n) => noticeMessage(DATE, n)),
      albumCaption({ date: DATE, snapshot, images: [image(), failed()] }),
      albumCaption({ date: DATE, snapshot, images: [failed(), failed()] }),
      postCaptionMessage("x"),
      previewFailedMessage("x"),
    ]
    for (const text of all) expect(text).not.toMatch(/[—–]/)
  })
})
