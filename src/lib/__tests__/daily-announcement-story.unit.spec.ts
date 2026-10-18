jest.mock("../telegram", () => ({
  ...jest.requireActual("../telegram"),
  sendTelegram: jest.fn(),
}))
jest.mock("../story-announcement", () => ({
  ...jest.requireActual("../story-announcement"),
  checkAnnouncementUrl: jest.fn(),
}))
// Each test reloads the job (see loadJob); stubbing these keeps that from
// re-importing the whole Medusa framework every time.
jest.mock("@medusajs/framework/utils", () => ({
  ContainerRegistrationKeys: { LOGGER: "logger" },
}))
jest.mock("../../modules/stories", () => ({ STORIES_MODULE: "stories" }))

type Slot = {
  id: string
  plan_id: string
  slot_index: number
  scheduled_at: Date
  category_id: string
  metadata: Record<string, unknown> | null
  posted_at: Date | null
}
type Plan = { id: string; plan_date: string }

const SALE_ENV = {
  STORIES_ANNOUNCEMENT_MP4_URL:
    "https://cdn.dollupboutique.com/campaigns/2026-10-october-sale/stories/{date}-{n}.mp4",
  STORIES_ANNOUNCEMENT_FROM: "2026-10-19",
  STORIES_ANNOUNCEMENT_UNTIL: "2026-11-01",
  STORIES_ANNOUNCEMENT_TIME: "12:45,17:00,20:00",
  STORIES_ANNOUNCEMENT_LABEL: "October Sale",
}
const LEGACY_ENV = {
  STORIES_ANNOUNCEMENT_MP4_URL: "https://cdn.dollupboutique.com/announcements/break.mp4",
  STORIES_ANNOUNCEMENT_UNTIL: "2026-10-16",
  STORIES_ANNOUNCEMENT_LABEL: "Shop break",
}
const ENV_KEYS = [
  "STORIES_ANNOUNCEMENT_MP4_URL",
  "STORIES_ANNOUNCEMENT_FROM",
  "STORIES_ANNOUNCEMENT_UNTIL",
  "STORIES_ANNOUNCEMENT_TIME",
  "STORIES_ANNOUNCEMENT_LABEL",
]
const saleUrl = (date: string, n: number) =>
  `https://cdn.dollupboutique.com/campaigns/2026-10-october-sale/stories/${date}-${n}.mp4`

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }

function fakeStories(opts: { planDates?: string[] } = {}) {
  let seq = 0
  const plans: Plan[] = (opts.planDates ?? []).map((d) => ({
    id: `stplan_${++seq}`,
    plan_date: d,
  }))
  const slots: Slot[] = []
  // Five product slots per pre-existing plan, like create-tomorrow-plan makes.
  for (const p of plans) {
    for (let i = 0; i < 5; i++) {
      slots.push({
        id: `stslot_${++seq}`,
        plan_id: p.id,
        slot_index: i,
        scheduled_at: new Date(`${p.plan_date}T1${i}:00:00+04:00`),
        category_id: "pcat_dresses",
        metadata: { render: { template_slug: "on-sale", mp4_url: "https://r2/x.mp4" } },
        posted_at: null,
      })
    }
  }
  return {
    plans,
    slots,
    announcements: (planDate: string) => {
      const plan = plans.find((p) => p.plan_date === planDate)
      return slots
        .filter((s) => s.plan_id === plan?.id && s.category_id === "__announcement__")
        .sort((a, b) => a.slot_index - b.slot_index)
    },
    listStoryPlans: jest.fn(async (filter: { plan_date?: string }) =>
      plans.filter((p) => p.plan_date === filter.plan_date),
    ),
    createPlan: jest.fn(async (input: { plan_date: string }) => {
      const p = { id: `stplan_${++seq}`, plan_date: input.plan_date }
      plans.push(p)
      return p
    }),
    listStorySlots: jest.fn(async (filter: { plan_id: string }) =>
      slots.filter((s) => s.plan_id === filter.plan_id),
    ),
    addFillerSlot: jest.fn(
      async (input: {
        plan_id: string
        template_slug: string
        scheduled_at: Date
        category_id?: string
      }) => {
        const slot_index =
          slots
            .filter((s) => s.plan_id === input.plan_id)
            .reduce((max, s) => Math.max(max, s.slot_index), -1) + 1
        const slot: Slot = {
          id: `stslot_${++seq}`,
          plan_id: input.plan_id,
          slot_index,
          scheduled_at: input.scheduled_at,
          category_id: input.category_id ?? "__filler__",
          metadata: { forced_template_slug: input.template_slug },
          posted_at: null,
        }
        slots.push(slot)
        return { slot_id: slot.id, slot_index }
      },
    ),
    updateSlotMetadata: jest.fn(async (id: string, patch: Record<string, unknown>) => {
      const slot = slots.find((s) => s.id === id)!
      slot.metadata = { ...(slot.metadata ?? {}), ...patch }
    }),
    /** What regeneratePlan does to every unposted slot. */
    regenerate: (planDate: string) => {
      const plan = plans.find((p) => p.plan_date === planDate)!
      for (let i = slots.length - 1; i >= 0; i--) {
        if (slots[i].plan_id === plan.id && !slots[i].posted_at) slots.splice(i, 1)
      }
    },
  }
}
type FakeStories = ReturnType<typeof fakeStories>

function container(stories: FakeStories) {
  return {
    resolve: (key: string) => {
      if (key === "logger") return logger
      if (key === "stories") return stories
      throw new Error(`unexpected resolve ${key}`)
    },
  } as never
}

/** Fresh job module per test: the once-a-day alert memory is module state. */
function loadJob() {
  let loaded!: {
    run: (c: never) => Promise<void>
    sendTelegram: jest.Mock
    checkUrl: jest.Mock
  }
  jest.isolateModules(() => {
    loaded = {
      run: require("../../jobs/daily-announcement-story").default,
      sendTelegram: require("../telegram").sendTelegram,
      checkUrl: require("../story-announcement").checkAnnouncementUrl,
    }
  })
  loaded.sendTelegram.mockResolvedValue({ ok: true })
  loaded.checkUrl.mockResolvedValue({ ok: true, status: 200 })
  return loaded
}

/** Fakes only Date, so promises and the job's awaits run normally. */
function setNow(iso: string) {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  })
}

function setEnv(vars: Record<string, string>) {
  for (const k of ENV_KEYS) delete process.env[k]
  Object.assign(process.env, vars)
}

const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

beforeEach(() => jest.clearAllMocks())
afterEach(() => {
  jest.useRealTimers()
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe("daily-announcement-story job", () => {
  it("legacy config (one time, fixed URL): one slot as before, second tick is a no-op", async () => {
    setEnv(LEGACY_ENV)
    setNow("2026-09-20T20:07:00Z") // 00:07 MU, 21 Sep
    const stories = fakeStories({ planDates: ["2026-09-21"] })
    const { run, checkUrl, sendTelegram } = loadJob()

    await run(container(stories))

    expect(stories.addFillerSlot).toHaveBeenCalledTimes(1)
    expect(stories.addFillerSlot).toHaveBeenCalledWith({
      plan_id: stories.plans[0].id,
      template_slug: "announcement",
      scheduled_at: new Date("2026-09-21T05:00:00.000Z"), // 09:00 MU default
      category_id: "__announcement__",
    })
    const [slot] = stories.announcements("2026-09-21")
    expect(slot.slot_index).toBe(5)
    expect(slot.metadata).toEqual({
      forced_template_slug: "announcement",
      announcement: {
        n: 1,
        label: "Shop break",
        mp4_url: LEGACY_ENV.STORIES_ANNOUNCEMENT_MP4_URL,
        added_at: "2026-09-20T20:07:00.000Z",
      },
      render: {
        template_slug: "announcement",
        mp4_url: LEGACY_ENV.STORIES_ANNOUNCEMENT_MP4_URL,
      },
    })
    expect(checkUrl).not.toHaveBeenCalled() // no placeholders, no HTTP

    setNow("2026-09-20T21:07:00Z")
    await run(container(stories))
    expect(stories.addFillerSlot).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(
      "[announcement] 2026-09-21: slot already present — skipping",
    )
    expect(sendTelegram).not.toHaveBeenCalled()
  })

  it("legacy config queued late still goes out the same day (no late-start guard)", async () => {
    setEnv(LEGACY_ENV)
    setNow("2026-09-21T10:07:00Z") // 14:07 MU, five hours after 09:00
    const stories = fakeStories({ planDates: ["2026-09-21"] })
    const { run } = loadJob()

    await run(container(stories))

    const [slot] = stories.announcements("2026-09-21")
    expect(slot.scheduled_at).toEqual(new Date("2026-09-21T10:09:00.000Z"))
  })

  it("an announcement queued before this change (no n) still blocks a duplicate", async () => {
    setEnv(LEGACY_ENV)
    setNow("2026-09-21T03:07:00Z")
    const stories = fakeStories({ planDates: ["2026-09-21"] })
    stories.slots.push({
      id: "stslot_old",
      plan_id: stories.plans[0].id,
      slot_index: 5,
      scheduled_at: new Date("2026-09-21T05:00:00Z"),
      category_id: "__announcement__",
      metadata: {
        forced_template_slug: "announcement",
        announcement: { label: "Shop break", mp4_url: "https://x", added_at: "…" },
        render: { template_slug: "announcement", mp4_url: "https://x" },
      },
      posted_at: null,
    })
    const { run } = loadJob()

    await run(container(stories))
    expect(stories.addFillerSlot).not.toHaveBeenCalled()

    // Switching to three times mid-day keeps it as #1 and adds #2 and #3.
    setEnv({ ...LEGACY_ENV, STORIES_ANNOUNCEMENT_TIME: "09:00,12:45,17:00" })
    await run(container(stories))
    expect(
      stories.announcements("2026-09-21").map((s) => (s.metadata as any).announcement.n),
    ).toEqual([undefined, 2, 3])
  })

  it("October Sale config: three slots with the day's own files, then idempotent", async () => {
    setEnv(SALE_ENV)
    setNow("2026-10-18T20:07:00Z") // 00:07 MU, Mon 19 Oct
    const stories = fakeStories({ planDates: ["2026-10-19"] })
    const { run, checkUrl, sendTelegram } = loadJob()

    await run(container(stories))

    const slots = stories.announcements("2026-10-19")
    expect(
      slots.map((s) => ({
        n: (s.metadata as any).announcement.n,
        at: s.scheduled_at.toISOString(),
        url: (s.metadata as any).render.mp4_url,
        label: (s.metadata as any).announcement.label,
      })),
    ).toEqual([
      { n: 1, at: "2026-10-19T08:45:00.000Z", url: saleUrl("2026-10-19", 1), label: "October Sale" },
      { n: 2, at: "2026-10-19T13:00:00.000Z", url: saleUrl("2026-10-19", 2), label: "October Sale" },
      { n: 3, at: "2026-10-19T16:00:00.000Z", url: saleUrl("2026-10-19", 3), label: "October Sale" },
    ])
    expect(checkUrl.mock.calls.map((c) => c[0])).toEqual([
      saleUrl("2026-10-19", 1),
      saleUrl("2026-10-19", 2),
      saleUrl("2026-10-19", 3),
    ])

    setNow("2026-10-18T21:07:00Z")
    await run(container(stories))
    expect(stories.announcements("2026-10-19")).toHaveLength(3)
    expect(checkUrl).toHaveBeenCalledTimes(3) // nothing missing, nothing fetched
    expect(sendTelegram).not.toHaveBeenCalled()
  })

  it("self-heals after Regenerate: puts back what's still due, keeps what posted", async () => {
    setEnv(SALE_ENV)
    setNow("2026-10-18T20:07:00Z")
    const stories = fakeStories({ planDates: ["2026-10-19"] })
    const { run } = loadJob()
    await run(container(stories))

    const [first] = stories.announcements("2026-10-19")
    first.posted_at = new Date("2026-10-19T08:45:00Z") // 12:45 went out
    stories.regenerate("2026-10-19") // admin presses Regenerate at ~13:00 MU
    expect(stories.announcements("2026-10-19")).toHaveLength(1)

    setNow("2026-10-19T09:07:00Z") // 13:07 MU
    await run(container(stories))

    const after = stories.announcements("2026-10-19")
    expect(after.map((s) => (s.metadata as any).announcement.n)).toEqual([1, 2, 3])
    expect(after[0].id).toBe(first.id)
    expect(after.slice(1).map((s) => s.scheduled_at.toISOString())).toEqual([
      "2026-10-19T13:00:00.000Z",
      "2026-10-19T16:00:00.000Z",
    ])
  })

  it("a deploy at 16:00 MU skips the 12:45 story instead of posting it late", async () => {
    setEnv(SALE_ENV)
    setNow("2026-10-19T12:07:00Z") // 16:07 MU
    const stories = fakeStories({ planDates: ["2026-10-19"] })
    const { run, checkUrl } = loadJob()

    await run(container(stories))

    expect(
      stories.announcements("2026-10-19").map((s) => (s.metadata as any).announcement.n),
    ).toEqual([2, 3])
    expect(logger.info).toHaveBeenCalledWith(
      "[announcement] 2026-10-19 #1 (12:45): skipped, time passed",
    )
    expect(checkUrl).toHaveBeenCalledTimes(2)
  })

  it("a missing file skips its slot, alerts once that day, and is queued once uploaded", async () => {
    setEnv(SALE_ENV)
    setNow("2026-10-18T20:07:00Z")
    const stories = fakeStories({ planDates: ["2026-10-19", "2026-10-20"] })
    const { run, checkUrl, sendTelegram } = loadJob()
    const missing = new Set([saleUrl("2026-10-19", 2)])
    checkUrl.mockImplementation(async (url: string) =>
      missing.has(url)
        ? { ok: false, status: 404, reason: "HTTP 404" }
        : { ok: true, status: 200 },
    )

    await run(container(stories))
    expect(
      stories.announcements("2026-10-19").map((s) => (s.metadata as any).announcement.n),
    ).toEqual([1, 3])
    expect(sendTelegram).toHaveBeenCalledTimes(1)
    const text = sendTelegram.mock.calls[0][0] as string
    expect(text).toContain("Announcement story file missing")
    expect(text).toContain("#2 at 17:00: HTTP 404")
    expect(text).toContain(saleUrl("2026-10-19", 2))

    setNow("2026-10-18T21:07:00Z") // still missing an hour later: no second alert
    await run(container(stories))
    expect(sendTelegram).toHaveBeenCalledTimes(1)

    missing.clear() // owner uploads it
    setNow("2026-10-18T22:07:00Z")
    await run(container(stories))
    expect(
      stories.announcements("2026-10-19").map((s) => (s.metadata as any).announcement.n),
    ).toEqual([1, 3, 2])
    expect(sendTelegram).toHaveBeenCalledTimes(1)

    missing.add(saleUrl("2026-10-20", 1)) // a new MU day gets its own alert
    setNow("2026-10-19T20:07:00Z")
    await run(container(stories))
    expect(sendTelegram).toHaveBeenCalledTimes(2)
    expect(sendTelegram.mock.calls[1][0]).toContain("2026-10-20")
  })

  it("retries the missing-file alert next tick if Telegram failed to send it", async () => {
    setEnv(SALE_ENV)
    setNow("2026-10-18T20:07:00Z")
    const stories = fakeStories({ planDates: ["2026-10-19"] })
    const { run, checkUrl, sendTelegram } = loadJob()
    checkUrl.mockResolvedValue({ ok: false, status: 404, reason: "HTTP 404" })
    sendTelegram.mockResolvedValueOnce({ ok: false, status: 0, message: "ETIMEDOUT" })

    await run(container(stories))
    setNow("2026-10-18T21:07:00Z")
    await run(container(stories))
    setNow("2026-10-18T22:07:00Z")
    await run(container(stories))

    expect(sendTelegram).toHaveBeenCalledTimes(2) // failed once, delivered once
  })

  it("creates an empty plan when today has none, then queues into it", async () => {
    setEnv(SALE_ENV)
    setNow("2026-10-18T20:07:00Z")
    const stories = fakeStories()
    const { run } = loadJob()

    await run(container(stories))

    expect(stories.createPlan).toHaveBeenCalledWith({
      plan_date: "2026-10-19",
      category_distribution: [],
      scheduled_times: [],
      notes: "Auto-created for the daily announcement story (October Sale)",
    })
    expect(stories.announcements("2026-10-19").map((s) => s.slot_index)).toEqual([0, 1, 2])
  })

  it("alerts on a hard failure, as before", async () => {
    setEnv(SALE_ENV)
    setNow("2026-10-18T20:07:00Z")
    const stories = fakeStories({ planDates: ["2026-10-19"] })
    stories.addFillerSlot.mockRejectedValueOnce(new Error("db down"))
    const { run, sendTelegram } = loadJob()

    await expect(run(container(stories))).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith("[announcement] 2026-10-19: db down")
    expect(sendTelegram).toHaveBeenCalledTimes(1)
    expect(sendTelegram.mock.calls[0][0]).toContain("Announcement story not queued")
  })

  it("logs invalid time entries and uses the valid ones", async () => {
    setEnv({ ...SALE_ENV, STORIES_ANNOUNCEMENT_TIME: "12:45,noon,17:00,12:45" })
    setNow("2026-10-18T20:07:00Z")
    const stories = fakeStories({ planDates: ["2026-10-19"] })
    const { run } = loadJob()

    await run(container(stories))

    expect(logger.warn).toHaveBeenCalledWith(
      '[announcement] STORIES_ANNOUNCEMENT_TIME: ignored "noon" (not HH:mm) — using 12:45,17:00',
    )
    expect(stories.announcements("2026-10-19")).toHaveLength(2)
  })

  it("stays dormant outside FROM..UNTIL", async () => {
    setEnv(SALE_ENV)
    setNow("2026-10-17T20:07:00Z") // 18 Oct MU, the day before the sale
    const stories = fakeStories({ planDates: ["2026-10-18"] })
    const { run } = loadJob()

    await run(container(stories))

    expect(stories.listStoryPlans).not.toHaveBeenCalled()
  })
})
