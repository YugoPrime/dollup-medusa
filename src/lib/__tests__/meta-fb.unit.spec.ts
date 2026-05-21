import {
  MetaFbError,
  isFbCrosspostEnabled,
  isMetaFbConfigured,
  publishFbVideoStory,
  readMetaFbEnv,
} from "../meta-fb"

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  jest.restoreAllMocks()
  // Restore env between tests so order doesn't matter.
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k]
  }
  Object.assign(process.env, ORIGINAL_ENV)
})

const cfg = {
  pageId: "page_123",
  pageAccessToken: "page-token",
  apiVersion: "v21.0",
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("readMetaFbEnv", () => {
  it("returns null when META_PAGE_ACCESS_TOKEN is missing", () => {
    delete process.env.META_PAGE_ACCESS_TOKEN
    process.env.META_FB_PAGE_ID = "1234567890"
    expect(readMetaFbEnv()).toBeNull()
  })

  it("returns null when META_FB_PAGE_ID is missing", () => {
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    delete process.env.META_FB_PAGE_ID
    expect(readMetaFbEnv()).toBeNull()
  })

  it("returns config when both env vars are set", () => {
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    process.env.META_API_VERSION = "v21.0"
    expect(readMetaFbEnv()).toEqual({
      pageAccessToken: "token",
      pageId: "1234567890",
      apiVersion: "v21.0",
    })
  })

  it("defaults apiVersion to v21.0 when unset", () => {
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    delete process.env.META_API_VERSION
    expect(readMetaFbEnv()?.apiVersion).toBe("v21.0")
  })
})

describe("isMetaFbConfigured", () => {
  it("reflects readMetaFbEnv", () => {
    delete process.env.META_PAGE_ACCESS_TOKEN
    delete process.env.META_FB_PAGE_ID
    expect(isMetaFbConfigured()).toBe(false)

    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    expect(isMetaFbConfigured()).toBe(true)
  })
})

describe("isFbCrosspostEnabled", () => {
  it("returns false when STORIES_CROSSPOST_FB is unset", () => {
    delete process.env.STORIES_CROSSPOST_FB
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    expect(isFbCrosspostEnabled()).toBe(false)
  })

  it("returns false when STORIES_CROSSPOST_FB is anything but the string 'true'", () => {
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    process.env.STORIES_CROSSPOST_FB = "1"
    expect(isFbCrosspostEnabled()).toBe(false)
    process.env.STORIES_CROSSPOST_FB = "yes"
    expect(isFbCrosspostEnabled()).toBe(false)
    process.env.STORIES_CROSSPOST_FB = "TRUE"
    expect(isFbCrosspostEnabled()).toBe(false)
  })

  it("returns false when flag is 'true' but creds missing", () => {
    process.env.STORIES_CROSSPOST_FB = "true"
    delete process.env.META_PAGE_ACCESS_TOKEN
    delete process.env.META_FB_PAGE_ID
    expect(isFbCrosspostEnabled()).toBe(false)
  })

  it("returns true when flag is 'true' AND creds present", () => {
    process.env.STORIES_CROSSPOST_FB = "true"
    process.env.META_PAGE_ACCESS_TOKEN = "token"
    process.env.META_FB_PAGE_ID = "1234567890"
    expect(isFbCrosspostEnabled()).toBe(true)
  })
})

describe("publishFbVideoStory", () => {
  it("starts, uploads the public URL to upload_url, then finishes", async () => {
    const videoUrl = "https://cdn.dollupboutique.com/stories/slot/hash.mp4"
    const fetchMock = jest.spyOn(global, "fetch")
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          video_id: "video_123",
          upload_url: "https://rupload.facebook.com/video-upload/v21.0/video_123",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: {
            video_status: "processing",
            uploading_phase: { status: "in_progress" },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true, post_id: "post_456" }))

    await expect(publishFbVideoStory({ videoUrl }, cfg)).resolves.toBe("post_456")

    expect(fetchMock).toHaveBeenCalledTimes(3)

    const startUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(startUrl.origin).toBe("https://graph.facebook.com")
    expect(startUrl.pathname).toBe("/v21.0/page_123/video_stories")
    expect(startUrl.searchParams.get("access_token")).toBe("page-token")
    expect(startUrl.searchParams.get("upload_phase")).toBe("start")
    expect(startUrl.searchParams.get("file_url")).toBeNull()
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ method: "POST" }),
    )

    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://rupload.facebook.com/video-upload/v21.0/video_123",
    )
    expect(fetchMock.mock.calls[1][1]).toEqual({
      method: "POST",
      headers: {
        Authorization: "OAuth page-token",
        file_url: videoUrl,
      },
    })

    const finishUrl = new URL(String(fetchMock.mock.calls[2][0]))
    expect(finishUrl.pathname).toBe("/v21.0/page_123/video_stories")
    expect(finishUrl.searchParams.get("access_token")).toBe("page-token")
    expect(finishUrl.searchParams.get("upload_phase")).toBe("finish")
    expect(finishUrl.searchParams.get("video_id")).toBe("video_123")
  })

  it("fails fast when start does not return an upload_url", async () => {
    const fetchMock = jest.spyOn(global, "fetch")
    fetchMock.mockResolvedValueOnce(jsonResponse({ video_id: "video_123" }))

    await expect(
      publishFbVideoStory({ videoUrl: "https://cdn.example.com/story.mp4" }, cfg),
    ).rejects.toThrow("FB video_stories start returned no upload_url")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("maps upload_url API errors into MetaFbError details", async () => {
    const fetchMock = jest.spyOn(global, "fetch")
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          video_id: "video_123",
          upload_url: "https://rupload.facebook.com/video-upload/v21.0/video_123",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              message: "Video Upload Is Missing",
              code: 6000,
              error_subcode: 1363130,
              fbtrace_id: "trace_123",
              error_user_msg: "Meta could not fetch the video file.",
            },
          },
          400,
        ),
      )

    try {
      await publishFbVideoStory(
        { videoUrl: "https://cdn.example.com/story.mp4" },
        cfg,
      )
      throw new Error("Expected publishFbVideoStory to throw")
    } catch (err) {
      expect(err).toBeInstanceOf(MetaFbError)
      const fbErr = err as MetaFbError
      expect(fbErr.message).toBe("Video Upload Is Missing")
      expect(fbErr.status).toBe(400)
      expect(fbErr.metaErrorCode).toBe(6000)
      expect(fbErr.metaErrorSubcode).toBe(1363130)
      expect(fbErr.fbtraceId).toBe("trace_123")
      expect(fbErr.errorUserMsg).toBe("Meta could not fetch the video file.")
    }
  })
})
