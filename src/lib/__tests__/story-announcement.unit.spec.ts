import {
  resolveAnnouncementForDate,
  resolveAnnouncementScheduledAt,
} from "../story-announcement"

const BASE = {
  STORIES_ANNOUNCEMENT_MP4_URL: "https://cdn.dollupboutique.com/announcements/x.mp4",
  STORIES_ANNOUNCEMENT_UNTIL: "2026-10-16",
}

describe("resolveAnnouncementForDate", () => {
  it("is disabled by default — no MP4 url, no announcement", () => {
    expect(resolveAnnouncementForDate("2026-09-21", {})).toBeNull()
    expect(
      resolveAnnouncementForDate("2026-09-21", {
        STORIES_ANNOUNCEMENT_MP4_URL: "  ",
        STORIES_ANNOUNCEMENT_UNTIL: "2026-10-16",
      }),
    ).toBeNull()
  })

  it("refuses to run without an end date, so it can never post forever", () => {
    expect(
      resolveAnnouncementForDate("2026-09-21", {
        STORIES_ANNOUNCEMENT_MP4_URL: BASE.STORIES_ANNOUNCEMENT_MP4_URL,
      }),
    ).toBeNull()
    expect(
      resolveAnnouncementForDate("2026-09-21", {
        ...BASE,
        STORIES_ANNOUNCEMENT_UNTIL: "16/10/2026",
      }),
    ).toBeNull()
  })

  it("rejects a non-https MP4 url — Meta will not ingest one", () => {
    expect(
      resolveAnnouncementForDate("2026-09-21", {
        ...BASE,
        STORIES_ANNOUNCEMENT_MP4_URL: "http://cdn.dollupboutique.com/a.mp4",
      }),
    ).toBeNull()
  })

  it("returns config inside the window, with a 09:00 default", () => {
    const r = resolveAnnouncementForDate("2026-09-21", BASE)
    expect(r).not.toBeNull()
    expect(r!.mp4Url).toBe(BASE.STORIES_ANNOUNCEMENT_MP4_URL)
    expect(r!.scheduledTime).toBe("09:00")
    expect(r!.label).toBe("Announcement")
  })

  it("posts on the last day and stops the day after", () => {
    expect(resolveAnnouncementForDate("2026-10-16", BASE)).not.toBeNull()
    expect(resolveAnnouncementForDate("2026-10-17", BASE)).toBeNull()
  })

  it("honours an optional start date", () => {
    const env = { ...BASE, STORIES_ANNOUNCEMENT_FROM: "2026-09-22" }
    expect(resolveAnnouncementForDate("2026-09-21", env)).toBeNull()
    expect(resolveAnnouncementForDate("2026-09-22", env)).not.toBeNull()
  })

  it("falls back to 09:00 on a malformed time", () => {
    for (const bad of ["9:00", "24:00", "noon", ""]) {
      const r = resolveAnnouncementForDate("2026-09-21", {
        ...BASE,
        STORIES_ANNOUNCEMENT_TIME: bad,
      })
      expect(r!.scheduledTime).toBe("09:00")
    }
    const ok = resolveAnnouncementForDate("2026-09-21", {
      ...BASE,
      STORIES_ANNOUNCEMENT_TIME: "18:30",
    })
    expect(ok!.scheduledTime).toBe("18:30")
  })
})

describe("resolveAnnouncementScheduledAt", () => {
  it("uses the configured Mauritius time when it is still ahead", () => {
    // 04:00 UTC = 08:00 MU, so 09:00 MU has not happened yet.
    const now = new Date("2026-09-21T04:00:00Z")
    expect(
      resolveAnnouncementScheduledAt("2026-09-21", "09:00", now).toISOString(),
    ).toBe("2026-09-21T05:00:00.000Z")
  })

  it("pushes just past now when the slot is created after its own time", () => {
    // 10:00 UTC = 14:00 MU — 09:00 MU is 5h gone, well outside the publish
    // cron's 2h look-back, so scheduling at 09:00 would never post.
    const now = new Date("2026-09-21T10:00:00Z")
    const at = resolveAnnouncementScheduledAt("2026-09-21", "09:00", now)
    expect(at.getTime()).toBe(now.getTime() + 2 * 60 * 1000)
  })
})
