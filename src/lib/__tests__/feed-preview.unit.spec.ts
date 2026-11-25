import sharp from "sharp"

import { buildFeedPreviewImages } from "../feed-preview"

const whitePng = () =>
  sharp({ create: { width: 600, height: 800, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .png()
    .toBuffer()

const snapshot = {
  handle: "is2462",
  variants_in_stock: [
    { color: "White", sizes: ["M", "S"], image_urls: ["w.jpg"], price_mur: 975, price_max_mur: 975 },
    { color: "Red", sizes: ["L"], image_urls: ["r.jpg"], price_mur: 1050, price_max_mur: 1050 },
  ],
}

function decode(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.replace(/^data:image\/jpeg;base64,/, ""), "base64")
}

describe("buildFeedPreviewImages", () => {
  it("returns one 540x675 JPEG data URL per photo, with that photo's sizes", async () => {
    const png = await whitePng()
    const images = await buildFeedPreviewImages({
      imageUrls: ["w.jpg", "r.jpg"],
      snapshot,
      fetchImage: async () => png,
    })

    expect(images.map((i) => [i.source_url, i.sizes, i.price?.price_mur, i.sku])).toEqual([
      ["w.jpg", ["S", "M"], 975, "IS2462"],
      ["r.jpg", ["L"], 1050, "IS2462"],
    ])
    for (const image of images) {
      expect(image.data_url).toMatch(/^data:image\/jpeg;base64,/)
      const meta = await sharp(decode(image.data_url!)).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 540, 675])
    }
  })

  it("keeps going when one photo can't be fetched", async () => {
    const png = await whitePng()
    const images = await buildFeedPreviewImages({
      imageUrls: ["gone.jpg", "w.jpg"],
      snapshot,
      fetchImage: async (url) => {
        if (url === "gone.jpg") throw new Error("boom: HTTP 404")
        return png
      },
    })

    expect(images[0]).toEqual(
      expect.objectContaining({ source_url: "gone.jpg", data_url: null, error: expect.stringMatching(/boom/) }),
    )
    expect(images[1].data_url).toMatch(/^data:image\/jpeg;base64,/)
  })
})
