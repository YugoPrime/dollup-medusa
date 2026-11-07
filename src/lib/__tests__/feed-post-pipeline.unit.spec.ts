const publishFeedImages = jest.fn()
const publishFbPhotoPost = jest.fn()
const prepareFeedImages = jest.fn()

jest.mock("../meta-ig", () => ({
  isMetaIgConfigured: () => true,
  publishFeedImages: (...a: unknown[]) => publishFeedImages(...a),
}))
jest.mock("../meta-fb", () => ({
  isFeedFbCrosspostEnabled: () => true,
  publishFbPhotoPost: (...a: unknown[]) => publishFbPhotoPost(...a),
}))
jest.mock("../feed-image-prep", () => ({
  prepareFeedImages: (...a: unknown[]) => prepareFeedImages(...a),
}))

import { publishFeedPostRow } from "../feed-post-pipeline"
import { FEED_POSTS_MODULE } from "../../modules/feed-posts"

function fakeScope(row: Record<string, unknown>) {
  const feed = {
    listFeedPosts: jest.fn(async () => [row]),
    markFailed: jest.fn(async () => 1),
    markPosted: jest.fn(async () => undefined),
  }
  const scope = {
    resolve: (key: string) => {
      if (key === FEED_POSTS_MODULE) return feed
      throw new Error(`unexpected resolve ${key}`)
    },
  }
  return { scope: scope as never, feed }
}

const row = {
  id: "fp_1",
  post_date: "2026-11-10",
  status: "planned",
  caption: "Floral Wrap Dress",
  image_urls: ["https://cdn/is2449.png", "https://cdn/is2449-b.webp"],
}

beforeEach(() => {
  publishFeedImages.mockReset()
  publishFbPhotoPost.mockReset()
  prepareFeedImages.mockReset()
})

describe("publishFeedPostRow", () => {
  it("posts the JPEG copies to Instagram and Facebook, not the original photos", async () => {
    const jpegs = ["https://cdn/feed/2026-11-10/a-v1.jpg", "https://cdn/feed/2026-11-10/b-v1.jpg"]
    prepareFeedImages.mockResolvedValue(jpegs)
    publishFeedImages.mockResolvedValue("ig_1")
    publishFbPhotoPost.mockResolvedValue("fb_1")
    const { scope, feed } = fakeScope(row)

    const res = await publishFeedPostRow({ scope, feedPostId: "fp_1" })

    expect(res).toEqual({ ok: true, ig_media_id: "ig_1", fb_post_id: "fb_1" })
    expect(prepareFeedImages).toHaveBeenCalledWith(row.image_urls, expect.objectContaining({ postDate: "2026-11-10" }))
    expect(publishFeedImages).toHaveBeenCalledWith({ imageUrls: jpegs, caption: "Floral Wrap Dress" })
    expect(publishFbPhotoPost).toHaveBeenCalledWith({ imageUrls: jpegs, caption: "Floral Wrap Dress" })
    expect(feed.markPosted).toHaveBeenCalledWith("fp_1", { ig_media_id: "ig_1", fb_post_id: "fb_1" })
  })

  it("counts a failed photo conversion as a failed attempt and posts nothing", async () => {
    prepareFeedImages.mockRejectedValue(new Error("No feed photo could be prepared: HTTP 404"))
    const { scope, feed } = fakeScope(row)

    const res = await publishFeedPostRow({ scope, feedPostId: "fp_1" })

    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/HTTP 404/)
    expect(feed.markFailed).toHaveBeenCalledWith("fp_1", expect.stringMatching(/HTTP 404/))
    expect(publishFeedImages).not.toHaveBeenCalled()
    expect(publishFbPhotoPost).not.toHaveBeenCalled()
  })
})
