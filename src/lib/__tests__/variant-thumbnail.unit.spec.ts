import { pickVariantThumbnail } from "../variant-thumbnail"

describe("pickVariantThumbnail", () => {
  it("returns the first per-colour image url", () => {
    expect(
      pickVariantThumbnail({
        image_urls: [
          "https://cdn.dollupboutique.com/x/is2447-yellow.jpg",
          "https://cdn.dollupboutique.com/x/is2447-yellow-b.jpg",
        ],
      }),
    ).toBe("https://cdn.dollupboutique.com/x/is2447-yellow.jpg")
  })

  it("returns null when there is no per-colour imagery", () => {
    expect(pickVariantThumbnail(null)).toBeNull()
    expect(pickVariantThumbnail(undefined)).toBeNull()
    expect(pickVariantThumbnail({})).toBeNull()
    expect(pickVariantThumbnail({ image_urls: [] })).toBeNull()
  })

  it("ignores non-string and blank entries, and skips to the first usable url", () => {
    expect(
      pickVariantThumbnail({
        image_urls: [null, "", 42, "  ", "https://cdn.dollupboutique.com/x/a.jpg"],
      }),
    ).toBe("https://cdn.dollupboutique.com/x/a.jpg")
  })

  it("rejects a non-array image_urls", () => {
    expect(pickVariantThumbnail({ image_urls: "https://x/a.jpg" })).toBeNull()
  })
})
