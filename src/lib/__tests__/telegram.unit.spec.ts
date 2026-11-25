import { sendTelegramPhotos } from "../telegram"

const ENV_KEYS = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

// Telegram only sees bytes; the content doesn't matter here.
const JPEG_A = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const JPEG_B = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6])
const CAPTION = "📅 Tomorrow's grid post · Fri 27 Nov, 18:00\n<b>IS2571</b> · Satin Slip Dress"

const ok = () => new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 })

function sent(fetchMock: jest.SpyInstance) {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  expect(init.method).toBe("POST")
  expect(init.body).toBeInstanceOf(FormData)
  return { url: String(url), init, form: init.body as FormData }
}

async function fileBytes(entry: FormDataEntryValue | null): Promise<Buffer> {
  expect(entry).toBeInstanceOf(Blob)
  return Buffer.from(await (entry as Blob).arrayBuffer())
}

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = "123:abc"
  process.env.TELEGRAM_CHAT_ID = "-1001"
})
afterEach(() => {
  jest.restoreAllMocks()
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe("sendTelegramPhotos", () => {
  it("is dormant, like sendTelegram, without TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID", async () => {
    const fetchMock = jest.spyOn(global, "fetch")

    delete process.env.TELEGRAM_BOT_TOKEN
    expect(await sendTelegramPhotos([JPEG_A, JPEG_B], { caption: CAPTION })).toEqual({ ok: false, skipped: true })
    process.env.TELEGRAM_BOT_TOKEN = "123:abc"
    delete process.env.TELEGRAM_CHAT_ID
    expect(await sendTelegramPhotos([JPEG_A], { caption: CAPTION })).toEqual({ ok: false, skipped: true })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sends 2 to 10 photos as one album, with the caption and parse_mode on the first photo only", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(ok())

    expect(await sendTelegramPhotos([JPEG_A, JPEG_B], { caption: CAPTION })).toEqual({ ok: true })

    const { url, init, form } = sent(fetchMock)
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendMediaGroup")
    // fetch writes the multipart content-type (with its boundary) itself.
    expect(new Headers(init.headers).has("content-type")).toBe(false)
    expect([...form.keys()]).toEqual(["chat_id", "media", "photo0", "photo1"])
    expect(form.get("chat_id")).toBe("-1001")
    expect(JSON.parse(form.get("media") as string)).toEqual([
      { type: "photo", media: "attach://photo0", caption: CAPTION, parse_mode: "HTML" },
      { type: "photo", media: "attach://photo1" },
    ])
    expect(await fileBytes(form.get("photo0"))).toEqual(JPEG_A)
    expect(await fileBytes(form.get("photo1"))).toEqual(JPEG_B)
    expect((form.get("photo0") as File).type).toBe("image/jpeg")
    expect((form.get("photo0") as File).name).toBe("photo0.jpg")
  })

  it("sends a single photo with sendPhoto", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(ok())

    expect(await sendTelegramPhotos([JPEG_A], { caption: CAPTION })).toEqual({ ok: true })

    const { url, form } = sent(fetchMock)
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendPhoto")
    expect([...form.keys()]).toEqual(["chat_id", "photo", "caption", "parse_mode"])
    expect(form.get("chat_id")).toBe("-1001")
    expect(await fileBytes(form.get("photo"))).toEqual(JPEG_A)
    expect((form.get("photo") as File).type).toBe("image/jpeg")
    expect(form.get("caption")).toBe(CAPTION)
    expect(form.get("parse_mode")).toBe("HTML")
  })

  it("sends no caption fields without a caption, and no parse_mode when formatting is off", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async () => ok())

    await sendTelegramPhotos([JPEG_A, JPEG_B])
    await sendTelegramPhotos([JPEG_A], { caption: "plain text", parseMode: null })

    const album = fetchMock.mock.calls[0][1]!.body as FormData
    expect(JSON.parse(album.get("media") as string)).toEqual([
      { type: "photo", media: "attach://photo0" },
      { type: "photo", media: "attach://photo1" },
    ])
    const single = fetchMock.mock.calls[1][1]!.body as FormData
    expect(single.get("caption")).toBe("plain text")
    expect(single.has("parse_mode")).toBe(false)
  })

  it("uses an explicit chat id over TELEGRAM_CHAT_ID", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(ok())

    await sendTelegramPhotos([JPEG_A], { chatId: "42" })

    expect(sent(fetchMock).form.get("chat_id")).toBe("42")
  })

  it("refuses an empty album or more than 10 photos without calling Telegram", async () => {
    const fetchMock = jest.spyOn(global, "fetch")

    expect(await sendTelegramPhotos([])).toEqual({ ok: false, status: 0, message: expect.stringMatching(/1 to 10 photos, got 0/) })
    expect(await sendTelegramPhotos(Array(11).fill(JPEG_A))).toEqual({
      ok: false,
      status: 0,
      message: expect.stringMatching(/1 to 10 photos, got 11/),
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns Telegram's refusal instead of throwing", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: can't parse entities" }), {
        status: 400,
      }),
    )

    expect(await sendTelegramPhotos([JPEG_A, JPEG_B], { caption: CAPTION })).toEqual({
      ok: false,
      status: 400,
      message: expect.stringContaining("can't parse entities"),
    })
  })

  it("returns a network error instead of throwing", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("socket hang up"))

    expect(await sendTelegramPhotos([JPEG_A, JPEG_B])).toEqual({ ok: false, status: 0, message: "socket hang up" })
  })
})
