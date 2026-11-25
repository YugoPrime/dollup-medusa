jest.mock("../telegram", () => ({
  ...jest.requireActual("../telegram"),
  sendTelegram: jest.fn(),
  sendTelegramPhotos: jest.fn(),
}))
jest.mock("../meta-ig", () => ({ isMetaIgConfigured: jest.fn() }))
// The two database reads; the refresh and the drawing run for real.
jest.mock("../grid-planner", () => ({ inspectGridRow: jest.fn(), loadGridProduct: jest.fn() }))

import sharp from "sharp"

import tomorrowFeedPreview, { config } from "../../jobs/tomorrow-feed-preview"
import { FEED_POSTS_MODULE } from "../../modules/feed-posts"
import type { FeedPostDTO } from "../../modules/feed-posts/service"
import { inspectGridRow, loadGridProduct } from "../grid-planner"
import { isMetaIgConfigured } from "../meta-ig"
import { sendTelegram, sendTelegramPhotos } from "../telegram"
import { BACK, FRONT, IS2571_PRODUCT, PLANNED_ROW, whitePng } from "./fixtures/is2571"

const PLANNER = `<a href="https://admin.dollupboutique.com/feed-planner">`
const ALBUM_CAPTION = "📅 Tomorrow's grid post · Fri 27 Nov, 18:00\n<b>IS2571</b> · Satin Slip Dress · Rs 1,100 · S M L"
const CAPTION_MESSAGE = [
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
  `✏️ ${PLANNER}Change it in the Feed Planner</a> (Replace / Keep off social)`,
].join("\n")

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }

/** Only findByDate exists: the preview must never write. */
function fakeContainer(row: FeedPostDTO | null | Error) {
  const feed = {
    findByDate: jest.fn(async (date: string) => {
      if (row instanceof Error) throw row
      return row && row.post_date === date ? row : null
    }),
  }
  const scope = {
    resolve: (key: string) => {
      if (key === "logger") return logger
      if (key === FEED_POSTS_MODULE) return feed
      throw new Error(`unexpected resolve ${key}`)
    },
  }
  return { scope: scope as never, feed }
}

/** Fakes only Date, so promises, fetch and sharp run normally. */
function setNow(iso: string) {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  })
}

const savedAutoPublish = process.env.FEED_AUTO_PUBLISH
let png: Buffer
let failing: Set<string>

beforeAll(async () => {
  png = await whitePng()
})
beforeEach(() => {
  jest.clearAllMocks()
  setNow("2026-11-26T16:00:00Z") // 20:00 Thu 26 Nov, Mauritius
  process.env.FEED_AUTO_PUBLISH = "true"
  failing = new Set()
  jest.mocked(isMetaIgConfigured).mockReturnValue(true)
  jest.mocked(sendTelegram).mockResolvedValue({ ok: true })
  jest.mocked(sendTelegramPhotos).mockResolvedValue({ ok: true })
  jest.mocked(inspectGridRow).mockResolvedValue({ problem: null, refreshed: null })
  jest.mocked(loadGridProduct).mockResolvedValue({ product: IS2571_PRODUCT, published: true, socialExcluded: false })
  jest.spyOn(global, "fetch").mockImplementation(async (url) =>
    failing.has(String(url)) ? new Response("", { status: 404 }) : new Response(new Uint8Array(png)),
  )
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
  if (savedAutoPublish === undefined) delete process.env.FEED_AUTO_PUBLISH
  else process.env.FEED_AUTO_PUBLISH = savedAutoPublish
})

const telegramTexts = () => jest.mocked(sendTelegram).mock.calls.map((c) => c[0])

describe("tomorrow-feed-preview job", () => {
  it("runs at 20:00 Mauritius every day", () => {
    expect(config).toEqual({ name: "tomorrow-feed-preview", schedule: "0 16 * * *" })
  })

  it.each([undefined, "false"])("stays silent when FEED_AUTO_PUBLISH is %s, like the 18:00 publish", async (value) => {
    if (value === undefined) delete process.env.FEED_AUTO_PUBLISH
    else process.env.FEED_AUTO_PUBLISH = value
    const { scope, feed } = fakeContainer(PLANNED_ROW)

    await tomorrowFeedPreview(scope)

    expect(feed.findByDate).not.toHaveBeenCalled()
    expect(sendTelegram).not.toHaveBeenCalled()
    expect(sendTelegramPhotos).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      '[feed-tg-preview] 2026-11-27: FEED_AUTO_PUBLISH is not "true", nothing posts at 18:00, no preview',
    )
  })

  it("sends tomorrow's post as it will go out: the drawn photos, then the caption", async () => {
    const { scope, feed } = fakeContainer(PLANNED_ROW)

    await tomorrowFeedPreview(scope)

    expect(feed.findByDate).toHaveBeenCalledWith("2026-11-27")
    // The same check the 18:00 run makes, against tomorrow's stories.
    expect(inspectGridRow).toHaveBeenCalledWith(scope, PLANNED_ROW, "2026-11-27")
    expect(sendTelegramPhotos).toHaveBeenCalledTimes(1)
    const [photos, opts] = jest.mocked(sendTelegramPhotos).mock.calls[0]
    expect(opts).toEqual({ caption: ALBUM_CAPTION })
    expect(photos).toHaveLength(2)
    for (const photo of photos) {
      const meta = await sharp(photo).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 540, 675])
    }
    // The caption is rebuilt from the live product, not the stored one.
    expect(telegramTexts()).toEqual([CAPTION_MESSAGE])
    expect(jpegOrder()).toBe(true)
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      '[feed-tg-preview] 2026-11-27: preview of "Satin Slip Dress", 2 of 2 photo(s) drawn',
    )
  })

  it("leaves out a photo that couldn't be drawn and says so", async () => {
    failing.add(BACK)
    const { scope } = fakeContainer(PLANNED_ROW)

    await tomorrowFeedPreview(scope)

    const [photos, opts] = jest.mocked(sendTelegramPhotos).mock.calls[0]
    expect(photos).toHaveLength(1)
    expect(opts).toEqual({ caption: `${ALBUM_CAPTION}\n⚠️ 1 photo couldn't be drawn` })
    expect(telegramTexts()).toEqual([CAPTION_MESSAGE])
  })

  it("sends the summary as text when no photo could be drawn", async () => {
    failing.add(FRONT)
    failing.add(BACK)
    const { scope } = fakeContainer(PLANNED_ROW)

    await tomorrowFeedPreview(scope)

    expect(sendTelegramPhotos).not.toHaveBeenCalled()
    expect(telegramTexts()).toEqual([
      `${ALBUM_CAPTION}\n⚠️ None of the 2 photos could be drawn, so the post may fail at 18:00`,
      CAPTION_MESSAGE,
    ])
  })

  it("no row for tomorrow: one short text, the date in Mauritius", async () => {
    setNow("2026-11-30T16:00:00Z") // 20:00 Mon 30 Nov: tomorrow is in December
    const { scope, feed } = fakeContainer(null)

    await tomorrowFeedPreview(scope)

    expect(feed.findByDate).toHaveBeenCalledWith("2026-12-01")
    expect(inspectGridRow).not.toHaveBeenCalled()
    expect(sendTelegramPhotos).not.toHaveBeenCalled()
    expect(telegramTexts()).toEqual([
      [
        "🟡 <b>No grid post planned for tomorrow</b> · Tue 1 Dec",
        "",
        "At 18:00 one will be picked automatically, if a product can go out.",
        `✏️ ${PLANNER}Choose one in the Feed Planner</a>`,
      ].join("\n"),
    ])
  })

  it.each([
    ["posted", { status: "posted" as const }, "Tomorrow's grid post is already up"],
    ["skipped", { status: "skipped" as const }, "The day is marked as skipped, so nothing posts at 18:00."],
    ["failed 3 times", { status: "failed" as const, attempt_count: 3 }, "failed 3 times, so it won't be tried again."],
  ])("a row that is %s: one short text, no product check", async (_label, over, expected) => {
    const { scope } = fakeContainer({ ...PLANNED_ROW, ...over })

    await tomorrowFeedPreview(scope)

    expect(inspectGridRow).not.toHaveBeenCalled()
    expect(sendTelegramPhotos).not.toHaveBeenCalled()
    expect(telegramTexts()).toHaveLength(1)
    expect(telegramTexts()[0]).toContain(expected)
  })

  it("a planned product that can't go out: says 18:00 will swap it", async () => {
    jest.mocked(inspectGridRow).mockResolvedValue({ problem: "sold_out", refreshed: null })
    const { scope } = fakeContainer(PLANNED_ROW)

    await tomorrowFeedPreview(scope)

    expect(loadGridProduct).not.toHaveBeenCalled()
    expect(sendTelegramPhotos).not.toHaveBeenCalled()
    expect(telegramTexts()).toEqual([
      [
        "🔁 <b>Tomorrow's grid post will be swapped</b> · Fri 27 Nov",
        "",
        "<b>IS2571</b> · Satin Slip Dress: it is sold out.",
        "At 18:00 another product will be picked instead, if one can go out.",
        `✏️ ${PLANNER}Choose one in the Feed Planner</a>`,
      ].join("\n"),
    ])
  })

  it("a failed row is tried again at 18:00, unless its product can't go out", async () => {
    const failedRow = { ...PLANNED_ROW, status: "failed" as const, attempt_count: 1, error: "IG timeout" }
    const { scope } = fakeContainer(failedRow)

    await tomorrowFeedPreview(scope)
    expect(telegramTexts()[0]).toContain("At 18:00 it will be tried again.")

    jest.mocked(sendTelegram).mockClear()
    jest.mocked(inspectGridRow).mockResolvedValue({ problem: "off_social", refreshed: null })
    await tomorrowFeedPreview(scope)
    expect(telegramTexts()[0]).toContain("failed earlier and won't be tried again: it is kept off social.")
    expect(sendTelegramPhotos).not.toHaveBeenCalled()
  })

  it("Instagram not connected: says nothing can post, without reading the plan", async () => {
    jest.mocked(isMetaIgConfigured).mockReturnValue(false)
    const { scope, feed } = fakeContainer(PLANNED_ROW)

    await tomorrowFeedPreview(scope)

    expect(feed.findByDate).not.toHaveBeenCalled()
    expect(telegramTexts()).toHaveLength(1)
    expect(telegramTexts()[0]).toContain("Instagram isn't connected on the server")
  })

  it("a crash becomes one Telegram alert, and the job still ends normally", async () => {
    const { scope } = fakeContainer(new Error("connection refused"))

    await expect(tomorrowFeedPreview(scope)).resolves.toBeUndefined()

    expect(telegramTexts()).toEqual([
      [
        "⚠️ <b>Tomorrow's grid post preview failed: connection refused</b>",
        "",
        "This doesn't stop the 18:00 post.",
        `✏️ ${PLANNER}Check it in the Feed Planner</a>`,
      ].join("\n"),
    ])
    expect(logger.error).toHaveBeenCalledWith(
      "[feed-tg-preview] 2026-11-27: Tomorrow's grid post preview failed: connection refused",
    )
  })

  it("a Telegram failure is logged, never thrown, and the caption still goes", async () => {
    jest.mocked(sendTelegramPhotos).mockResolvedValue({ ok: false, status: 400, message: "Bad Request: can't parse entities" })
    jest.mocked(sendTelegram).mockResolvedValue({ ok: false, status: 0, message: "socket hang up" })
    const { scope } = fakeContainer(PLANNED_ROW)

    await expect(tomorrowFeedPreview(scope)).resolves.toBeUndefined()

    expect(telegramTexts()).toEqual([CAPTION_MESSAGE])
    expect(logger.error).toHaveBeenCalledWith(
      "[feed-tg-preview] 2026-11-27 photos not sent (400): Bad Request: can't parse entities",
    )
    expect(logger.error).toHaveBeenCalledWith("[feed-tg-preview] 2026-11-27 caption not sent (0): socket hang up")
  })

  it("Telegram not set up is logged as such, not as an error", async () => {
    jest.mocked(sendTelegramPhotos).mockResolvedValue({ ok: false, skipped: true })
    jest.mocked(sendTelegram).mockResolvedValue({ ok: false, skipped: true })
    const { scope } = fakeContainer(PLANNED_ROW)

    await tomorrowFeedPreview(scope)

    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      "[feed-tg-preview] 2026-11-27 photos not sent: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set",
    )
  })
})

/** The album goes before the caption. */
function jpegOrder(): boolean {
  const album = jest.mocked(sendTelegramPhotos).mock.invocationCallOrder[0]
  const caption = jest.mocked(sendTelegram).mock.invocationCallOrder[0]
  return album < caption
}
