import { mergeSocialFlag } from "../product-social"

describe("mergeSocialFlag", () => {
  it("sets no_social and keeps every other metadata key", () => {
    expect(mergeSocialFlag({ unlisted: false, search_terms: "x" }, true)).toEqual({
      unlisted: false,
      search_terms: "x",
      no_social: true,
    })
  })

  it("works on empty metadata", () => {
    expect(mergeSocialFlag(null, false)).toEqual({ no_social: false })
  })

  it("does not mutate the input", () => {
    const meta = { cutout_image_url: "u" }
    mergeSocialFlag(meta, true)
    expect(meta).toEqual({ cutout_image_url: "u" })
  })
})
