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
    expect(a).toMatch(/^feed\/2026-11-10\/[a-f0-9]{16}-v1\.jpg$/)
    expect(a).not.toBe(feedImageKey("2026-11-10", "https://cdn/x/is2449-b.png"))
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
