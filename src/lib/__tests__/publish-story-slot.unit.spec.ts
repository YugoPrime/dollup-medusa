import {
  readAttemptCount,
  readFbPublishError,
  readLastAttemptAt,
  readPriorFbStoryId,
  readRender,
} from "../publish-story-slot"

describe("publish-story-slot helpers", () => {
  describe("readRender", () => {
    it("returns null when metadata is null/undefined/empty", () => {
      expect(readRender(null)).toBeNull()
      expect(readRender(undefined)).toBeNull()
      expect(readRender({})).toBeNull()
    })

    it("returns null when metadata.render is missing required fields", () => {
      expect(readRender({ render: {} })).toBeNull()
      expect(readRender({ render: { template_slug: "x" } })).toBeNull()
      expect(readRender({ render: { mp4_url: "http://x" } })).toBeNull()
      expect(
        readRender({ render: { template_slug: 1, mp4_url: "http://x" } }),
      ).toBeNull()
    })

    it("returns the render block when both template_slug + mp4_url are strings", () => {
      const r = readRender({
        render: {
          template_slug: "on-sale",
          mp4_url: "https://r2/x.mp4",
          extra: "ignored",
        },
      })
      expect(r).toEqual({ template_slug: "on-sale", mp4_url: "https://r2/x.mp4" })
    })
  })

  describe("readAttemptCount", () => {
    it("returns 0 when no publish_error is present", () => {
      expect(readAttemptCount(null)).toBe(0)
      expect(readAttemptCount({})).toBe(0)
      expect(readAttemptCount({ publish_error: null })).toBe(0)
    })

    it("returns the attempt_count when set", () => {
      expect(readAttemptCount({ publish_error: { attempt_count: 2 } })).toBe(2)
    })

    it("returns 0 for non-numeric attempt_count", () => {
      expect(readAttemptCount({ publish_error: { attempt_count: "foo" } })).toBe(0)
    })
  })

  describe("readLastAttemptAt", () => {
    it("returns null when missing", () => {
      expect(readLastAttemptAt(null)).toBeNull()
      expect(readLastAttemptAt({ publish_error: {} })).toBeNull()
    })

    it("parses the ISO date", () => {
      const iso = "2026-05-17T12:34:56.000Z"
      const date = readLastAttemptAt({ publish_error: { attempted_at: iso } })
      expect(date).not.toBeNull()
      expect(date!.toISOString()).toBe(iso)
    })

    it("returns null for invalid date strings", () => {
      expect(
        readLastAttemptAt({ publish_error: { attempted_at: "not a date" } }),
      ).toBeNull()
    })
  })

  describe("readFbPublishError", () => {
    it("returns null when metadata is null/empty/missing the key", () => {
      expect(readFbPublishError(null)).toBeNull()
      expect(readFbPublishError(undefined)).toBeNull()
      expect(readFbPublishError({})).toBeNull()
      expect(readFbPublishError({ fb_publish_error: null })).toBeNull()
    })

    it("returns null when fb_publish_error is not an object", () => {
      expect(readFbPublishError({ fb_publish_error: "oops" })).toBeNull()
      expect(readFbPublishError({ fb_publish_error: 42 })).toBeNull()
    })

    it("returns the error block when shape is valid", () => {
      const err = readFbPublishError({
        fb_publish_error: {
          message: "boom",
          status: 400,
          fbtrace_id: "abc",
          meta_code: 100,
          attempted_at: "2026-05-20T10:00:00.000Z",
        },
      })
      expect(err).toEqual({
        message: "boom",
        status: 400,
        fbtrace_id: "abc",
        meta_code: 100,
        attempted_at: "2026-05-20T10:00:00.000Z",
      })
    })

    it("requires message to be a string — returns null otherwise", () => {
      expect(
        readFbPublishError({ fb_publish_error: { status: 400 } }),
      ).toBeNull()
    })
  })

  describe("readPriorFbStoryId", () => {
    it("returns null when metadata is null/empty/missing publish", () => {
      expect(readPriorFbStoryId(null)).toBeNull()
      expect(readPriorFbStoryId(undefined)).toBeNull()
      expect(readPriorFbStoryId({})).toBeNull()
      expect(readPriorFbStoryId({ publish: null })).toBeNull()
    })

    it("returns null when publish.fb_story_id is missing or non-string", () => {
      expect(readPriorFbStoryId({ publish: {} })).toBeNull()
      expect(
        readPriorFbStoryId({ publish: { fb_story_id: null } }),
      ).toBeNull()
      expect(
        readPriorFbStoryId({ publish: { fb_story_id: 12345 } }),
      ).toBeNull()
      expect(
        readPriorFbStoryId({ publish: { fb_story_id: "" } }),
      ).toBeNull()
    })

    it("returns the prior FB story id when present", () => {
      expect(
        readPriorFbStoryId({
          publish: {
            media_id: "ig_123",
            fb_story_id: "fb_456",
          },
        }),
      ).toBe("fb_456")
    })
  })
})
