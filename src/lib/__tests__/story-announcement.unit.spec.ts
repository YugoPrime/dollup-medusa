import {
  ANNOUNCEMENT_CATEGORY_ID,
  checkAnnouncementUrl,
  hasAnnouncementPlaceholders,
  isAnnouncementTimePassed,
  missingAnnouncementIndexes,
  parseAnnouncementTimes,
  planAnnouncementSlots,
  readAnnouncementIndex,
  resolveAnnouncementForDate,
  resolveAnnouncementScheduledAt,
  resolveAnnouncementUrl,
  type AnnouncementConfig,
  type AnnouncementUrlCheck,
} from "../story-announcement"

const BASE = {
  STORIES_ANNOUNCEMENT_MP4_URL: "https://cdn.dollupboutique.com/announcements/x.mp4",
  STORIES_ANNOUNCEMENT_UNTIL: "2026-10-16",
}

const SALE_URL =
  "https://cdn.dollupboutique.com/campaigns/2026-10-october-sale/stories/{date}-{n}.mp4"

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

  it("returns config inside the window, with a single 09:00 default", () => {
    const r = resolveAnnouncementForDate("2026-09-21", BASE)
    expect(r).not.toBeNull()
    expect(r!.mp4Url).toBe(BASE.STORIES_ANNOUNCEMENT_MP4_URL)
    expect(r!.scheduledTimes).toEqual(["09:00"])
    expect(r!.droppedTimes).toEqual([])
    expect(r!.label).toBe("Announcement")
    expect(r!.templated).toBe(false)
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
      expect(r!.scheduledTimes).toEqual(["09:00"])
    }
    const ok = resolveAnnouncementForDate("2026-09-21", {
      ...BASE,
      STORIES_ANNOUNCEMENT_TIME: "18:30",
    })
    expect(ok!.scheduledTimes).toEqual(["18:30"])
  })

  it("reads the October Sale config: three times, templated URL, label", () => {
    const r = resolveAnnouncementForDate("2026-10-19", {
      STORIES_ANNOUNCEMENT_MP4_URL: SALE_URL,
      STORIES_ANNOUNCEMENT_FROM: "2026-10-19",
      STORIES_ANNOUNCEMENT_UNTIL: "2026-11-01",
      STORIES_ANNOUNCEMENT_TIME: "12:45,17:00,20:00",
      STORIES_ANNOUNCEMENT_LABEL: "October Sale",
    })
    expect(r).toEqual({
      mp4Url: SALE_URL,
      scheduledTimes: ["12:45", "17:00", "20:00"],
      droppedTimes: [],
      label: "October Sale",
      templated: true,
    })
  })
})

describe("parseAnnouncementTimes", () => {
  it("defaults to 09:00 when unset or empty", () => {
    expect(parseAnnouncementTimes(undefined)).toEqual({ times: ["09:00"], dropped: [] })
    expect(parseAnnouncementTimes("")).toEqual({ times: ["09:00"], dropped: [] })
    expect(parseAnnouncementTimes(" , ")).toEqual({ times: ["09:00"], dropped: [] })
  })

  it("keeps list order, so slot n is the n-th time even when unsorted", () => {
    expect(parseAnnouncementTimes("20:00,12:45,17:00").times).toEqual([
      "20:00",
      "12:45",
      "17:00",
    ])
  })

  it("trims entries and ignores a stray comma", () => {
    expect(parseAnnouncementTimes(" 12:45 , 17:00,20:00, ")).toEqual({
      times: ["12:45", "17:00", "20:00"],
      dropped: [],
    })
  })

  it("drops invalid entries and reports them", () => {
    expect(parseAnnouncementTimes("12:45,9:00,noon,24:00,17:00")).toEqual({
      times: ["12:45", "17:00"],
      dropped: ["9:00", "noon", "24:00"],
    })
  })

  it("removes duplicates, keeping the first occurrence", () => {
    expect(parseAnnouncementTimes("12:45,17:00,12:45, 17:00").times).toEqual([
      "12:45",
      "17:00",
    ])
  })

  it("falls back to 09:00 when every entry is invalid", () => {
    expect(parseAnnouncementTimes("noon,25:00")).toEqual({
      times: ["09:00"],
      dropped: ["noon", "25:00"],
    })
  })
})

describe("URL templating", () => {
  it("detects {date} and {n}", () => {
    expect(hasAnnouncementPlaceholders(SALE_URL)).toBe(true)
    expect(hasAnnouncementPlaceholders("https://x/{date}.mp4")).toBe(true)
    expect(hasAnnouncementPlaceholders("https://x/{n}.mp4")).toBe(true)
    expect(hasAnnouncementPlaceholders(BASE.STORIES_ANNOUNCEMENT_MP4_URL)).toBe(false)
    expect(hasAnnouncementPlaceholders("https://x/{day}.mp4")).toBe(false)
  })

  it("fills the MU plan date and the 1-based slot number", () => {
    expect(resolveAnnouncementUrl(SALE_URL, "2026-10-19", 2)).toBe(
      "https://cdn.dollupboutique.com/campaigns/2026-10-october-sale/stories/2026-10-19-2.mp4",
    )
  })

  it("fills every occurrence", () => {
    expect(resolveAnnouncementUrl("https://x/{date}/{n}/{date}-{n}.mp4", "2026-11-01", 3)).toBe(
      "https://x/2026-11-01/3/2026-11-01-3.mp4",
    )
  })

  it("leaves a URL without placeholders unchanged", () => {
    expect(
      resolveAnnouncementUrl(BASE.STORIES_ANNOUNCEMENT_MP4_URL, "2026-10-19", 3),
    ).toBe(BASE.STORIES_ANNOUNCEMENT_MP4_URL)
  })
})

describe("missingAnnouncementIndexes", () => {
  const ann = (n?: unknown) => ({
    category_id: ANNOUNCEMENT_CATEGORY_ID,
    metadata:
      n === undefined
        ? { announcement: { label: "x", mp4_url: "https://x" } }
        : { announcement: { n } },
  })

  it("returns every slot number when the plan has none", () => {
    expect(missingAnnouncementIndexes(3, [])).toEqual([1, 2, 3])
  })

  it("ignores product and filler slots", () => {
    expect(
      missingAnnouncementIndexes(2, [
        { category_id: "pcat_dresses", metadata: null },
        { category_id: "__filler__", metadata: { forced_template_slug: "how-to-order" } },
      ]),
    ).toEqual([1, 2])
  })

  it("returns only the numbers still missing", () => {
    expect(missingAnnouncementIndexes(3, [ann(1), ann(3)])).toEqual([2])
    expect(missingAnnouncementIndexes(3, [ann(1), ann(2), ann(3)])).toEqual([])
  })

  it("counts a pre-multi-slot announcement (no n) as slot 1", () => {
    expect(missingAnnouncementIndexes(3, [ann()])).toEqual([2, 3])
    expect(missingAnnouncementIndexes(1, [ann()])).toEqual([])
  })

  it("ignores numbers beyond today's count", () => {
    expect(missingAnnouncementIndexes(1, [ann(2)])).toEqual([1])
  })

  it("treats a missing or malformed n as 1", () => {
    expect(readAnnouncementIndex(null)).toBe(1)
    expect(readAnnouncementIndex({})).toBe(1)
    expect(readAnnouncementIndex({ announcement: null })).toBe(1)
    for (const bad of [0, -1, 1.5, "2", null]) {
      expect(readAnnouncementIndex({ announcement: { n: bad } })).toBe(1)
    }
    expect(readAnnouncementIndex({ announcement: { n: 3 } })).toBe(3)
  })
})

describe("isAnnouncementTimePassed (late-start guard)", () => {
  // 12:45 MU = 08:45 UTC
  it("is false before the time and up to exactly 30 min after it", () => {
    expect(
      isAnnouncementTimePassed("2026-10-19", "12:45", new Date("2026-10-19T08:00:00Z")),
    ).toBe(false)
    expect(
      isAnnouncementTimePassed("2026-10-19", "12:45", new Date("2026-10-19T09:15:00Z")),
    ).toBe(false)
  })

  it("is true once the time is more than 30 min gone", () => {
    expect(
      isAnnouncementTimePassed("2026-10-19", "12:45", new Date("2026-10-19T09:15:01Z")),
    ).toBe(true)
    // A deploy at 16:00 MU: the 12:45 story is long gone.
    expect(
      isAnnouncementTimePassed("2026-10-19", "12:45", new Date("2026-10-19T12:00:00Z")),
    ).toBe(true)
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

describe("checkAnnouncementUrl", () => {
  const URL = "https://cdn.dollupboutique.com/x/2026-10-19-1.mp4"

  function fakeFetch(
    ...responses: Array<{ status: number; cancel?: jest.Mock } | Error>
  ) {
    const fn = jest.fn(async (_url: string, _init?: RequestInit) => {
      const next = responses.shift()
      if (!next) throw new Error("unexpected extra request")
      if (next instanceof Error) throw next
      return {
        status: next.status,
        body: next.cancel ? { cancel: next.cancel } : null,
      } as unknown as Response
    })
    return fn
  }

  it("accepts a 2xx HEAD without downloading anything", async () => {
    const f = fakeFetch({ status: 200 })
    await expect(checkAnnouncementUrl(URL, { fetchImpl: f as never })).resolves.toEqual({
      ok: true,
      status: 200,
    })
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe(URL)
    expect(f.mock.calls[0][1]?.method).toBe("HEAD")
    expect(f.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it("rejects a 404 (file deleted) and anything else that isn't 2xx", async () => {
    for (const status of [404, 403, 500, 302]) {
      const f = fakeFetch({ status })
      await expect(checkAnnouncementUrl(URL, { fetchImpl: f as never })).resolves.toEqual({
        ok: false,
        status,
        reason: `HTTP ${status}`,
      })
      expect(f).toHaveBeenCalledTimes(1)
    }
  })

  it("falls back to a one-byte ranged GET when HEAD is refused", async () => {
    for (const refused of [405, 501]) {
      const cancel = jest.fn(async () => undefined)
      const f = fakeFetch({ status: refused }, { status: 206, cancel })
      await expect(checkAnnouncementUrl(URL, { fetchImpl: f as never })).resolves.toEqual({
        ok: true,
        status: 206,
      })
      expect(f).toHaveBeenCalledTimes(2)
      const getInit = f.mock.calls[1][1]!
      expect(getInit.method).toBe("GET")
      expect(getInit.headers).toEqual({ Range: "bytes=0-0" })
      expect(cancel).toHaveBeenCalled() // never streams the MP4
    }
  })

  it("rejects when the ranged GET fails too", async () => {
    const f = fakeFetch({ status: 405 }, { status: 404 })
    await expect(checkAnnouncementUrl(URL, { fetchImpl: f as never })).resolves.toEqual({
      ok: false,
      status: 404,
      reason: "HTTP 404",
    })
  })

  it("turns a network error into a failed check instead of throwing", async () => {
    const f = fakeFetch(new Error("getaddrinfo ENOTFOUND cdn.dollupboutique.com"))
    await expect(checkAnnouncementUrl(URL, { fetchImpl: f as never })).resolves.toEqual({
      ok: false,
      reason: "getaddrinfo ENOTFOUND cdn.dollupboutique.com",
    })
  })

  it("gives up after the timeout", async () => {
    // Never answers; only the abort signal ends it.
    const hang = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal!.reason),
          )
        }),
    )
    await expect(
      checkAnnouncementUrl(URL, { fetchImpl: hang as never, timeoutMs: 20 }),
    ).resolves.toEqual({ ok: false, reason: "no response within 20 ms" })
  })
})

describe("planAnnouncementSlots", () => {
  const SALE: AnnouncementConfig = {
    mp4Url: SALE_URL,
    scheduledTimes: ["12:45", "17:00", "20:00"],
    droppedTimes: [],
    label: "October Sale",
    templated: true,
  }
  const LEGACY: AnnouncementConfig = {
    mp4Url: BASE.STORIES_ANNOUNCEMENT_MP4_URL,
    scheduledTimes: ["09:00"],
    droppedTimes: [],
    label: "Shop break",
    templated: false,
  }
  const allThere = () =>
    jest.fn(async (): Promise<AnnouncementUrlCheck> => ({ ok: true, status: 200 }))
  const url = (n: number) => resolveAnnouncementUrl(SALE_URL, "2026-10-19", n)
  const legacySlot = {
    category_id: ANNOUNCEMENT_CATEGORY_ID,
    metadata: { announcement: { label: "old", mp4_url: "https://x" } },
  }

  it("legacy: one slot at its time, fixed URL, nothing fetched", async () => {
    const checkUrl = allThere()
    const plans = await planAnnouncementSlots({
      planDate: "2026-09-21",
      cfg: LEGACY,
      existingSlots: [],
      now: new Date("2026-09-20T20:07:00Z"), // 00:07 MU
      checkUrl,
    })
    expect(plans).toEqual([
      {
        n: 1,
        time: "09:00",
        mp4Url: LEGACY.mp4Url,
        action: "add",
        scheduledAt: new Date("2026-09-21T05:00:00Z"),
      },
    ])
    expect(checkUrl).not.toHaveBeenCalled()
  })

  it("legacy: no late-start guard — queued at 14:07 MU it goes out at 14:09", async () => {
    const now = new Date("2026-09-21T10:07:00Z") // 14:07 MU, 09:00 is 5h gone
    const plans = await planAnnouncementSlots({
      planDate: "2026-09-21",
      cfg: LEGACY,
      existingSlots: [],
      now,
      checkUrl: allThere(),
    })
    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({ n: 1, action: "add" })
    expect((plans[0] as { scheduledAt: Date }).scheduledAt.getTime()).toBe(
      now.getTime() + 2 * 60 * 1000,
    )
  })

  it("legacy: an existing slot means nothing to do", async () => {
    const plans = await planAnnouncementSlots({
      planDate: "2026-09-21",
      cfg: LEGACY,
      existingSlots: [legacySlot],
      now: new Date("2026-09-21T10:07:00Z"),
      checkUrl: allThere(),
    })
    expect(plans).toEqual([])
  })

  it("queues all three at their own times and files on the first tick of the day", async () => {
    const checkUrl = allThere()
    const plans = await planAnnouncementSlots({
      planDate: "2026-10-19",
      cfg: SALE,
      existingSlots: [],
      now: new Date("2026-10-18T20:07:00Z"), // 00:07 MU on the 19th
      checkUrl,
    })
    expect(plans).toEqual([
      { n: 1, time: "12:45", mp4Url: url(1), action: "add", scheduledAt: new Date("2026-10-19T08:45:00Z") },
      { n: 2, time: "17:00", mp4Url: url(2), action: "add", scheduledAt: new Date("2026-10-19T13:00:00Z") },
      { n: 3, time: "20:00", mp4Url: url(3), action: "add", scheduledAt: new Date("2026-10-19T16:00:00Z") },
    ])
    expect(checkUrl.mock.calls.map((c) => (c as unknown[])[0])).toEqual([url(1), url(2), url(3)])
  })

  it("only adds what's missing; a pre-multi-slot announcement counts as #1", async () => {
    const checkUrl = allThere()
    const plans = await planAnnouncementSlots({
      planDate: "2026-10-19",
      cfg: SALE,
      existingSlots: [legacySlot, { category_id: "pcat_dresses", metadata: null }],
      now: new Date("2026-10-18T20:07:00Z"),
      checkUrl,
    })
    expect(plans.map((p) => [p.n, p.action])).toEqual([
      [2, "add"],
      [3, "add"],
    ])
    expect(checkUrl).toHaveBeenCalledTimes(2)
  })

  it("late start at 16:07 MU: skips 12:45 without fetching it, queues 17:00 and 20:00", async () => {
    const checkUrl = allThere()
    const plans = await planAnnouncementSlots({
      planDate: "2026-10-19",
      cfg: SALE,
      existingSlots: [],
      now: new Date("2026-10-19T12:07:00Z"),
      checkUrl,
    })
    expect(plans.map((p) => [p.n, p.action])).toEqual([
      [1, "skip-time-passed"],
      [2, "add"],
      [3, "add"],
    ])
    expect(checkUrl.mock.calls.map((c) => (c as unknown[])[0])).toEqual([url(2), url(3)])
  })

  it("inside the 30 min grace, a late slot still goes out 2 min from now", async () => {
    const now = new Date("2026-10-19T09:07:00Z") // 13:07 MU, 22 min after 12:45
    const plans = await planAnnouncementSlots({
      planDate: "2026-10-19",
      cfg: SALE,
      existingSlots: [],
      now,
      checkUrl: allThere(),
    })
    expect(plans[0]).toMatchObject({ n: 1, action: "add" })
    expect((plans[0] as { scheduledAt: Date }).scheduledAt.getTime()).toBe(
      now.getTime() + 2 * 60 * 1000,
    )
  })

  it("skips a slot whose file is missing and keeps the others", async () => {
    const checkUrl = jest.fn(async (u: string): Promise<AnnouncementUrlCheck> =>
      u === url(2) ? { ok: false, status: 404, reason: "HTTP 404" } : { ok: true, status: 200 },
    )
    const plans = await planAnnouncementSlots({
      planDate: "2026-10-19",
      cfg: SALE,
      existingSlots: [],
      now: new Date("2026-10-18T20:07:00Z"),
      checkUrl,
    })
    expect(plans.map((p) => [p.n, p.action])).toEqual([
      [1, "add"],
      [2, "skip-missing-file"],
      [3, "add"],
    ])
    expect(plans[1]).toMatchObject({ mp4Url: url(2), reason: "HTTP 404" })
  })

  it("a fixed URL with several times posts the same file and checks nothing", async () => {
    const checkUrl = allThere()
    const plans = await planAnnouncementSlots({
      planDate: "2026-10-19",
      cfg: { ...LEGACY, scheduledTimes: ["12:45", "17:00"] },
      existingSlots: [],
      now: new Date("2026-10-18T20:07:00Z"),
      checkUrl,
    })
    expect(plans.map((p) => p.mp4Url)).toEqual([LEGACY.mp4Url, LEGACY.mp4Url])
    expect(checkUrl).not.toHaveBeenCalled()
  })

  it("one time with a templated URL is checked but keeps the no-guard behaviour", async () => {
    const checkUrl = allThere()
    const plans = await planAnnouncementSlots({
      planDate: "2026-10-19",
      cfg: { ...SALE, scheduledTimes: ["09:00"] },
      existingSlots: [],
      now: new Date("2026-10-19T12:07:00Z"), // 16:07 MU
      checkUrl,
    })
    expect(plans.map((p) => [p.n, p.action])).toEqual([[1, "add"]])
    expect(checkUrl).toHaveBeenCalledWith(url(1))
  })
})
