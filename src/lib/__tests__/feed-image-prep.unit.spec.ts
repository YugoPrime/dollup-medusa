import sharp from "sharp"

import {
  FEED_IMAGE_HEIGHT,
  FEED_IMAGE_WIDTH,
  feedImageKey,
  normalizeFeedImage,
  prepareFeedImages,
} from "../feed-image-prep"

async function solid(
  width: number,
  height: number,
  format: "png" | "webp" | "jpeg",
  background: { r: number; g: number; b: number; alpha?: number } = { r: 200, g: 30, b: 60 },
): Promise<Buffer> {
  const img = sharp({
    create: { width, height, channels: 4, background: { alpha: 1, ...background } },
  })
  return format === "png" ? img.png().toBuffer() : format === "webp" ? img.webp().toBuffer() : img.jpeg().toBuffer()
}

describe("normalizeFeedImage", () => {
  // Instagram's API only takes JPEG between 4:5 and 1.91:1, and crops every
  // carousel photo to the first one's shape, so every photo becomes 1080x1350.
  it("turns a tall 3:4 PNG into a 1080x1350 JPEG", async () => {
    const out = await normalizeFeedImage(await solid(300, 400, "png"))
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe("jpeg")
    expect([meta.width, meta.height]).toEqual([FEED_IMAGE_WIDTH, FEED_IMAGE_HEIGHT])
  })

  it("turns a wide WebP into a 1080x1350 JPEG", async () => {
    const out = await normalizeFeedImage(await solid(1600, 800, "webp"))
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe("jpeg")
    expect([meta.width, meta.height]).toEqual([FEED_IMAGE_WIDTH, FEED_IMAGE_HEIGHT])
  })

  it("upscales a tiny photo to the full size (IG refuses < 320 px wide)", async () => {
    const out = await normalizeFeedImage(await solid(228, 322, "jpeg"))
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([FEED_IMAGE_WIDTH, FEED_IMAGE_HEIGHT])
  })

  it("puts a transparent PNG on white, not black", async () => {
    const out = await normalizeFeedImage(
      await solid(400, 500, "png", { r: 0, g: 0, b: 0, alpha: 0 }),
    )
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    expect(data[0]).toBeGreaterThan(240)
    expect(data[1]).toBeGreaterThan(240)
    expect(data[2]).toBeGreaterThan(240)
  })

  it("rejects bytes that aren't an image", async () => {
    await expect(normalizeFeedImage(Buffer.from("<html>404</html>"))).rejects.toThrow()
  })
})

describe("feedImageKey", () => {
  it("is stable per source photo and post date, so retries overwrite the same file", () => {
    const a = feedImageKey("2026-11-10", "https://cdn/x/is2449.png")
    expect(a).toBe(feedImageKey("2026-11-10", "https://cdn/x/is2449.png"))
    expect(a).toMatch(/^feed\/2026-11-10\/[a-f0-9]{16}-v3\.jpg$/)
    expect(a).not.toBe(feedImageKey("2026-11-10", "https://cdn/x/is2449-b.png"))
  })

  it("changes when the price or the product code drawn on the photo change", () => {
    const base = feedImageKey("2026-11-10", "https://cdn/x/is2449.png", ["S"])
    const priced = feedImageKey("2026-11-10", "https://cdn/x/is2449.png", ["S"], {
      price: { price_mur: 975, from: false, was_mur: null },
    })
    const sale = feedImageKey("2026-11-10", "https://cdn/x/is2449.png", ["S"], {
      price: { price_mur: 690, from: false, was_mur: 975 },
    })
    const coded = feedImageKey("2026-11-10", "https://cdn/x/is2449.png", ["S"], { sku: "IS2449" })
    expect(new Set([base, priced, sale, coded]).size).toBe(4)
  })

  it("changes when the sizes drawn on the photo change", () => {
    const one = feedImageKey("2026-11-10", "https://cdn/x/is2449.png", ["S"])
    const two = feedImageKey("2026-11-10", "https://cdn/x/is2449.png", ["S", "M"])
    expect(one).not.toBe(two)
    expect(one).toMatch(/-v3\.jpg$/)
    expect(two).toMatch(/-v3\.jpg$/)
    expect(feedImageKey("2026-11-10", "https://cdn/x/is2449.png")).toBe(
      feedImageKey("2026-11-10", "https://cdn/x/is2449.png", []),
    )
  })
})

/** Mean and max luma (0-255) of a region of a JPEG/PNG buffer. */
async function regionLuma(
  img: Buffer,
  left: number,
  top: number,
  width: number,
  height: number,
): Promise<{ mean: number; max: number }> {
  const { data, info } = await sharp(img)
    .extract({ left, top, width, height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let sum = 0
  let max = 0
  for (let i = 0; i < data.length; i += info.channels) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    sum += l
    if (l > max) max = l
  }
  return { mean: sum / (data.length / info.channels), max }
}

describe("normalizeFeedImage with sizes", () => {
  const white = () => solid(1200, 1600, "png", { r: 255, g: 255, b: 255 })
  const black = () => solid(1200, 1600, "png", { r: 0, g: 0, b: 0 })

  it("draws a dark fade at the bottom", async () => {
    const withSizes = await normalizeFeedImage(await white(), { sizes: ["S", "M"] })
    const without = await normalizeFeedImage(await white())
    expect((await regionLuma(withSizes, 600, 1300, 450, 50)).mean).toBeLessThan(120)
    expect((await regionLuma(without, 600, 1300, 450, 50)).mean).toBeGreaterThan(240)
  })

  it("draws cream chips where the sizes go, and only there", async () => {
    const out = await normalizeFeedImage(await black(), { sizes: ["S", "M"] })
    expect((await regionLuma(out, 210, 1214, 90, 66)).max).toBeGreaterThan(230)
    expect((await regionLuma(out, 600, 1214, 450, 66)).max).toBeLessThan(60)
  })

  it("draws nothing when there are no sizes", async () => {
    const out = await normalizeFeedImage(await white(), { sizes: [] })
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([FEED_IMAGE_WIDTH, FEED_IMAGE_HEIGHT])
    expect((await regionLuma(out, 0, 1200, 1080, 150)).mean).toBeGreaterThan(240)
  })

  it("keeps 10 long sizes inside the photo", async () => {
    const out = await normalizeFeedImage(await black(), {
      sizes: ["XXS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "One size"],
    })
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height]).toEqual([FEED_IMAGE_WIDTH, FEED_IMAGE_HEIGHT])
    expect((await regionLuma(out, 210, 1136, 90, 144)).max).toBeGreaterThan(230)
    expect((await regionLuma(out, 1058, 1100, 22, 250)).max).toBeLessThan(100)
  })

  it("draws the whole letter in a one-letter chip (an L keeps its foot)", async () => {
    const out = await normalizeFeedImage(await black(), { sizes: ["L"] })
    const { data, info } = await sharp(out)
      .extract({ left: 225, top: 1225, width: 30, height: 44 })
      .raw()
      .toBuffer({ resolveWithObject: true })
    let ink = 0
    for (let i = 0; i < data.length; i += info.channels) {
      if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 100) ink++
    }
    expect(ink).toBeGreaterThan(100)
  })

  it("falls back to the plain photo when the size row can't be drawn", async () => {
    // Pango refuses these: "no text to render" / "invalid markup in text".
    for (const sizes of [["\u200b"], ["S\u0000M"]]) {
      const out = await normalizeFeedImage(await white(), { sizes })
      const meta = await sharp(out).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", FEED_IMAGE_WIDTH, FEED_IMAGE_HEIGHT])
    }
  })

  it("escapes markup characters in a size", async () => {
    const out = await normalizeFeedImage(await black(), { sizes: ["S&M", "<L>"] })
    expect((await regionLuma(out, 210, 1214, 90, 66)).max).toBeGreaterThan(230)
  })

  it("draws the row even when the font file is missing", async () => {
    let isolated: typeof import("../feed-image-prep") | undefined
    jest.isolateModules(() => {
      jest.doMock("node:fs", () => ({ ...jest.requireActual("node:fs"), existsSync: () => false }))
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      isolated = require("../feed-image-prep")
    })
    const out = await isolated!.normalizeFeedImage(await black(), { sizes: ["S", "M"] })
    expect((await regionLuma(out, 210, 1214, 90, 66)).max).toBeGreaterThan(230)
    jest.dontMock("node:fs")
  })
})

describe("normalizeFeedImage with the price and the product code", () => {
  const white = () => solid(1200, 1600, "png", { r: 255, g: 255, b: 255 })
  const black = () => solid(1200, 1600, "png", { r: 0, g: 0, b: 0 })
  const price = { price_mur: 975, from: false, was_mur: null }

  it("draws a dark pill with the code in the top-right corner", async () => {
    const out = await normalizeFeedImage(await white(), { sku: "IS2462" })
    // The pill's dark fill on a white photo, inside the 44 px margin.
    expect((await regionLuma(out, FEED_IMAGE_WIDTH - 120, 60, 40, 30)).mean).toBeLessThan(200)
    // Nothing in the opposite corner.
    expect((await regionLuma(out, 40, 40, 80, 60)).mean).toBeGreaterThan(245)
  })

  it("draws the price in white above the gold line", async () => {
    const out = await normalizeFeedImage(await black(), { sizes: ["S", "M"], price })
    // "Rs 975" ends 40 px above the gold line (y 1184): white ink in that band.
    expect((await regionLuma(out, 52, 1060, 300, 80)).max).toBeGreaterThan(230)
  })

  it("darkens a light photo further up when there is a price", async () => {
    const sizesOnly = await normalizeFeedImage(await white(), { sizes: ["S"] })
    const withPrice = await normalizeFeedImage(await white(), { sizes: ["S"], price })
    // Right of the price text, at the price's height: only the fade is there.
    expect((await regionLuma(withPrice, 700, 1050, 300, 60)).mean).toBeLessThan(
      (await regionLuma(sizesOnly, 700, 1050, 300, 60)).mean - 20,
    )
  })

  it("draws the price and the pill without a size row", async () => {
    const out = await normalizeFeedImage(await black(), { price, sku: "IS2462" })
    expect((await regionLuma(out, 52, 1150, 400, 110)).max).toBeGreaterThan(230)
    expect((await regionLuma(out, FEED_IMAGE_WIDTH - 200, 50, 150, 50)).max).toBeGreaterThan(230)
  })

  it("keeps the sizes and the price when the code can't be drawn", async () => {
    const out = await normalizeFeedImage(await black(), { sizes: ["S", "M"], price, sku: "​" })
    expect((await regionLuma(out, 210, 1214, 90, 66)).max).toBeGreaterThan(230)
    expect((await regionLuma(out, 52, 1060, 300, 80)).max).toBeGreaterThan(230)
  })

  it("ignores a zero price", async () => {
    const out = await normalizeFeedImage(await black(), { price: { price_mur: 0, from: false, was_mur: null } })
    expect((await regionLuma(out, 0, 900, FEED_IMAGE_WIDTH, 450)).max).toBeLessThan(10)
  })
})

describe("prepareFeedImages", () => {
  const png = solid(300, 400, "png")

  it("uploads a JPEG per photo and returns the new URLs in the same order", async () => {
    const uploaded: Array<{ key: string; type: string; format?: string }> = []
    const urls = await prepareFeedImages(
      ["https://cdn/a.png", "https://cdn/b.webp"],
      {
        postDate: "2026-11-10",
        fetchImage: async () => png,
        upload: async ({ key, body, contentType }) => {
          uploaded.push({ key, type: contentType, format: (await sharp(body).metadata()).format })
          return `https://cdn.example/${key}`
        },
      },
    )
    expect(urls).toEqual([
      `https://cdn.example/${feedImageKey("2026-11-10", "https://cdn/a.png")}`,
      `https://cdn.example/${feedImageKey("2026-11-10", "https://cdn/b.webp")}`,
    ])
    expect(uploaded.map((u) => [u.type, u.format])).toEqual([
      ["image/jpeg", "jpeg"],
      ["image/jpeg", "jpeg"],
    ])
  })

  it("skips a photo that can't be fetched and keeps the rest", async () => {
    const urls = await prepareFeedImages(["https://cdn/gone.png", "https://cdn/ok.png"], {
      postDate: "2026-11-10",
      fetchImage: async (url) => {
        if (url.includes("gone")) throw new Error("HTTP 404")
        return png
      },
      upload: async ({ key }) => `https://cdn.example/${key}`,
    })
    expect(urls).toEqual([
      `https://cdn.example/${feedImageKey("2026-11-10", "https://cdn/ok.png")}`,
    ])
  })

  it("draws each photo's own sizes and keys the copy by them", async () => {
    const keys: string[] = []
    await prepareFeedImages(["a", "b"], {
      postDate: "2026-11-10",
      fetchImage: async () => png,
      sizesFor: (u) => (u === "a" ? ["S"] : ["M"]),
      upload: async ({ key }) => {
        keys.push(key)
        return key
      },
    })
    expect(keys).toEqual([
      feedImageKey("2026-11-10", "a", ["S"]),
      feedImageKey("2026-11-10", "b", ["M"]),
    ])
  })

  it("fails when no photo could be prepared, naming the first error", async () => {
    await expect(
      prepareFeedImages(["https://cdn/gone.png"], {
        postDate: "2026-11-10",
        fetchImage: async () => {
          throw new Error("HTTP 404")
        },
        upload: async ({ key }) => key,
      }),
    ).rejects.toThrow(/HTTP 404/)
  })
})
