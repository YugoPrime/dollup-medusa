import type { RemoteJob } from "../cloud/client"
import type { TelegramSendResult } from "../../../lib/telegram"
import { sweepCloudRenders, type SweepDeps } from "../cloud/sweep"
import { buildCloudJob, MAX_SENDS_PER_SLOT, type CloudSlot } from "../cloud/job"
import type { RenderRequest } from "../types"

const NOW = new Date("2026-11-06T14:00:00.000Z")
const MIN = 60_000
const PLAN_ID = "stplan_1"
const CFG = {
  baseUrl: "https://render.example",
  apiKey: "test-key",
  callbackSecret: "test-secret",
  callbackUrl: "https://shop.example/hooks/story-render",
}
const REQ: RenderRequest = {
  template_slug: "in-stock-hero",
  slot_inputs: { hero: "https://r2/blush.jpg" },
  text_overrides: { title: "Hi" },
}

type Slot = CloudSlot & { metadata: Record<string, any> | null }
type Patch = Record<string, any>

function makeSlot(index: number, over: Partial<Slot> = {}): Slot {
  return {
    id: `stslot_s${index}`,
    plan_id: PLAN_ID,
    slot_index: index,
    // far from too late to post, and outside the 3 h unsent-alert window
    scheduled_at: new Date(NOW.getTime() + 240 * MIN),
    posted_at: null,
    metadata: null,
    product_snapshot: null,
    ...over,
  }
}

function withJob(slot: Slot, over: Patch = {}, meta: Patch = {}): Slot {
  const job = buildCloudJob(slot, REQ, "prod", CFG.callbackUrl)
  slot.metadata = {
    render_job: {
      job_id: job.job_id,
      output_key: job.output_key,
      template_slug: REQ.template_slug,
      slot_inputs: REQ.slot_inputs,
      text_overrides: REQ.text_overrides,
      state: "sent",
      dispatch_count: 1,
      sent_at: new Date(NOW.getTime() - 21 * MIN).toISOString(),
      ...over,
    },
    ...meta,
  }
  return slot
}

const done = (slot: Slot) =>
  withJob(slot, { state: "done", resolved_at: NOW.toISOString() })
const failedAtCap = (slot: Slot, message = "image 404") =>
  withJob(
    slot,
    {
      state: "failed",
      dispatch_count: MAX_SENDS_PER_SLOT,
      resolved_at: NOW.toISOString(),
    },
    { render_error: { message, name: "X", stage: "materialize" } },
  )

const jobOf = (s: Slot) => s.metadata!.render_job as Patch

function remote(slot: Slot, over: Partial<RemoteJob> = {}): RemoteJob {
  const job = jobOf(slot)
  return {
    job_id: job.job_id,
    status: "done",
    attempts: 1,
    mp4_url: `https://cdn.example.com/${job.output_key}`,
    error: null,
    callback_state: "sent",
    updated_at: NOW.toISOString(),
    ...over,
  }
}

function setup(
  slots: Slot[],
  getResult: (slot: Slot) => RemoteJob | "not_found" | "unavailable" = () =>
    "unavailable",
) {
  const byId = new Map(slots.map((s) => [s.id, s]))
  const merge = (id: string, patch: Patch) => {
    const s = byId.get(id)!
    s.metadata = { ...(s.metadata ?? {}), ...structuredClone(patch) }
  }
  const stories = {
    listStoryPlans: jest.fn(async (f: { id: string }) =>
      f.id === PLAN_ID ? [{ id: PLAN_ID }] : [],
    ),
    listStorySlots: jest.fn(async (f: { id?: string; plan_id?: string }) =>
      slots.filter((s) => (f.id ? s.id === f.id : s.plan_id === f.plan_id)),
    ),
    updateSlotMetadata: jest.fn(async (id: string, patch: Patch) => {
      merge(id, patch)
    }),
    updateSlotMetadataIfUnchanged: jest.fn(
      async (
        id: string,
        expected: { product_id: string | null; pick_attempt: number | null },
        patch: Patch,
      ) => {
        const s = byId.get(id)
        if (
          !s ||
          (s.product_id ?? null) !== (expected.product_id ?? null) ||
          (s.pick_attempt ?? null) !== (expected.pick_attempt ?? null)
        ) {
          return false
        }
        merge(id, patch)
        return true
      },
    ),
    updateSlotMetadataIfJob: jest.fn(
      async (
        id: string,
        jobId: string,
        patch: Patch,
        state?: { is?: string; isNot?: string },
      ) => {
        const s = byId.get(id)
        const job = (s?.metadata?.render_job ?? null) as Patch | null
        if (!s || s.posted_at || job?.job_id !== jobId) return false
        if (state?.is && job.state !== state.is) return false
        if (state?.isNot && job.state === state.isNot) return false
        merge(id, patch)
        return true
      },
    ),
    claimSlotMetadata: jest.fn(
      async (
        id: string,
        key: string,
        value: string,
        on:
          | { jobId: string; state?: { is?: string } }
          | { jobId: null; product_id: string | null; pick_attempt: number | null },
      ) => {
        const s = byId.get(id)
        const job = (s?.metadata?.render_job ?? null) as Patch | null
        if (!s || s.posted_at) return false
        if (on.jobId === null) {
          if (
            job ||
            (s.product_id ?? null) !== on.product_id ||
            (s.pick_attempt ?? null) !== on.pick_attempt
          ) {
            return false
          }
        } else if (job?.job_id !== on.jobId || (on.state?.is && job.state !== on.state.is)) {
          return false
        }
        if ((s.metadata?.[key] ?? null) === value) return false
        merge(id, { [key]: value })
        return true
      },
    ),
  }
  const client = {
    submit: jest.fn(
      async (_job: unknown) => ({ kind: "accepted", status: "queued" }) as const,
    ),
    get: jest.fn(async (jobId: string) => {
      const s = slots.find((x) => jobOf(x)?.job_id === jobId)
      return s ? getResult(s) : "not_found"
    }),
  }
  const telegram = jest.fn(
    async (_html: string): Promise<TelegramSendResult> => ({ ok: true }),
  )
  const deps: SweepDeps = {
    stories: stories as unknown as SweepDeps["stories"],
    client: client as unknown as SweepDeps["client"],
    cfg: CFG,
    now: () => NOW,
    telegram,
    upcomingPlans: async () => [{ id: PLAN_ID, plan_date: "2026-11-07" }],
    adminUrl: "https://admin.example/app",
  }
  return { deps, stories, client, telegram }
}

describe("sweepCloudRenders reconcile", () => {
  it("a job whose callback never came is applied from the service", async () => {
    const slot = withJob(makeSlot(1))
    const { deps, client } = setup([slot], (s) => remote(s))
    const out = await sweepCloudRenders(deps)
    expect(client.get).toHaveBeenCalledTimes(1)
    expect(slot.metadata!.render.mp4_url).toContain(jobOf(slot).output_key)
    expect(jobOf(slot).state).toBe("done")
    expect(out.reconciled).toBe(1)
  })

  it("a fresh job is left alone", async () => {
    const slot = withJob(makeSlot(1), {
      sent_at: new Date(NOW.getTime() - 5 * MIN).toISOString(),
    })
    const { deps, client } = setup([slot], (s) => remote(s))
    await sweepCloudRenders(deps)
    expect(client.get).not.toHaveBeenCalled()
    expect(client.submit).not.toHaveBeenCalled()
    expect(jobOf(slot).state).toBe("sent")
  })

  it("a job the service lost becomes retryable, with the send uncounted", async () => {
    // Stamped as the 2nd send; the service never got it, so 1 is written back.
    const slot = withJob(makeSlot(1), { dispatch_count: 2 })
    const first = withJob(makeSlot(2), { dispatch_count: 1 })
    const odd = withJob(makeSlot(3), { dispatch_count: 0 })
    const { deps } = setup([slot, first, odd], () => "not_found")
    await sweepCloudRenders(deps)
    expect(jobOf(first)).toMatchObject({ state: "failed", dispatch_count: 0 })
    expect(jobOf(odd)).toMatchObject({ state: "failed", dispatch_count: 0 })
    expect(jobOf(slot)).toMatchObject({
      state: "failed",
      dispatch_count: 1,
      resolved_at: NOW.toISOString(),
    })
    expect(jobOf(slot).template_slug).toBe(REQ.template_slug)
    expect(slot.metadata!.render_error).toEqual({
      message: "render service has no record of this job",
      name: "CloudSweepError",
      stage: "dispatch",
      stderr_tail: null,
      failed_at: NOW.toISOString(),
    })
    expect(slot.metadata!.render_started_at).toBeNull()
  })

  it("a job stuck for an hour gives up", async () => {
    const slot = withJob(makeSlot(1), {
      sent_at: new Date(NOW.getTime() - 61 * MIN).toISOString(),
    })
    const { deps } = setup([slot], (s) =>
      remote(s, { status: "rendering", mp4_url: null }),
    )
    await sweepCloudRenders(deps)
    expect(jobOf(slot)).toMatchObject({
      state: "failed",
      dispatch_count: MAX_SENDS_PER_SLOT,
    })
    expect(slot.metadata!.render_error).toMatchObject({
      stage: "stuck",
      message:
        "job still rendering after 60 min (OPERATIONS.md: dead-letter queue)",
    })
  })

  it("a slow job under an hour is left to finish", async () => {
    const slot = withJob(makeSlot(1))
    const { deps } = setup([slot], (s) =>
      remote(s, { status: "queued", mp4_url: null }),
    )
    await sweepCloudRenders(deps)
    expect(jobOf(slot).state).toBe("sent")
  })

  it("an unreachable service changes nothing", async () => {
    const slot = withJob(makeSlot(1), {
      sent_at: new Date(NOW.getTime() - 90 * MIN).toISOString(),
    })
    const { deps, stories, client } = setup([slot], () => "unavailable")
    const out = await sweepCloudRenders(deps)
    expect(client.submit).not.toHaveBeenCalled()
    expect(jobOf(slot).state).toBe("sent")
    expect(stories.updateSlotMetadataIfJob).not.toHaveBeenCalled()
    expect(out.reconciled).toBe(0)
  })

  it("one slot error does not stop the others", async () => {
    const a = withJob(makeSlot(1))
    const b = withJob(makeSlot(2))
    const { deps, client } = setup([a, b], (s) => remote(s))
    client.get.mockImplementationOnce(async () => {
      throw new Error("boom")
    })
    await sweepCloudRenders(deps)
    expect(jobOf(b).state).toBe("done")
  })

  describe("past the stuck limit", () => {
    const OLD = () => ({
      sent_at: new Date(NOW.getTime() - 61 * MIN).toISOString(),
    })
    const TOO_LATE = () => ({
      scheduled_at: new Date(NOW.getTime() - 130 * MIN),
    })
    const expectStuck = (slot: Slot, message: string) => {
      expect(jobOf(slot)).toMatchObject({
        state: "failed",
        dispatch_count: MAX_SENDS_PER_SLOT,
      })
      expect(slot.metadata!.render_error).toMatchObject({
        name: "CloudSweepError",
        stage: "stuck",
        message,
      })
    }

    it("done without an mp4_url gives up", async () => {
      const slot = withJob(makeSlot(1), OLD())
      const { deps } = setup([slot], (s) => remote(s, { mp4_url: null }))
      await sweepCloudRenders(deps)
      expectStuck(slot, "service reported done without an mp4_url")
    })

    it("an ignored callback gives up", async () => {
      const slot = withJob(makeSlot(1), OLD())
      const { deps } = setup([slot], (s) =>
        remote(s, { mp4_url: "https://cdn.example.com/elsewhere.mp4" }),
      )
      await sweepCloudRenders(deps)
      expectStuck(
        slot,
        "callback result ignored: mp4_url does not match output_key",
      )
    })

    it("an unknown status gives up", async () => {
      const slot = withJob(makeSlot(1), OLD())
      const { deps } = setup([slot], (s) =>
        remote(s, { status: "weird" as RemoteJob["status"], mp4_url: null }),
      )
      await sweepCloudRenders(deps)
      expectStuck(slot, "unknown job status weird")
    })

    it("an unreachable service gives up once the slot is too late to post", async () => {
      const slot = withJob(makeSlot(1, TOO_LATE()), OLD())
      const { deps } = setup([slot], () => "unavailable")
      await sweepCloudRenders(deps)
      expectStuck(slot, "render service unreachable")
    })

    it("an unreachable service is left alone while the slot can still post", async () => {
      const slot = withJob(makeSlot(1), OLD())
      const { deps } = setup([slot], () => "unavailable")
      await sweepCloudRenders(deps)
      expect(jobOf(slot).state).toBe("sent")
    })

    it("odd answers before the stuck limit are left alone", async () => {
      const slot = withJob(makeSlot(1))
      const { deps } = setup([slot], (s) => remote(s, { mp4_url: null }))
      await sweepCloudRenders(deps)
      expect(jobOf(slot).state).toBe("sent")
    })
  })
})

describe("sweepCloudRenders dispatch", () => {
  it("the sweep re-sends a failed slot after the retry gap", async () => {
    const slot = withJob(makeSlot(1), {
      state: "failed",
      dispatch_count: 1,
      resolved_at: new Date(NOW.getTime() - 11 * MIN).toISOString(),
    })
    const storedId = jobOf(slot).job_id
    const { deps, client } = setup([slot])
    const out = await sweepCloudRenders(deps)
    expect(client.submit).toHaveBeenCalledTimes(1)
    expect((client.submit.mock.calls[0][0] as { job_id: string }).job_id).toBe(
      storedId,
    )
    expect(out.dispatched).toBe(1)
    expect(jobOf(slot)).toMatchObject({ state: "sent", dispatch_count: 2 })
  })
})

describe("sweepCloudRenders summary", () => {
  const sixDone = () => [1, 2, 4, 5, 6, 7].map((i) => done(makeSlot(i)))

  it("waits while a slot renders", async () => {
    const slots = [
      ...sixDone(),
      withJob(makeSlot(3), {
        sent_at: new Date(NOW.getTime() - 2 * MIN).toISOString(),
      }),
    ]
    const { deps, telegram } = setup(slots)
    await sweepCloudRenders(deps)
    expect(telegram).not.toHaveBeenCalled()
  })

  it("waits for retries", async () => {
    const slots = [
      ...sixDone(),
      withJob(makeSlot(3), {
        state: "failed",
        dispatch_count: 1,
        resolved_at: new Date(NOW.getTime() - 2 * MIN).toISOString(),
      }),
    ]
    const { deps, telegram } = setup(slots)
    await sweepCloudRenders(deps)
    expect(telegram).not.toHaveBeenCalled()
  })

  it("sends one summary per plan, once", async () => {
    const slots = [...sixDone(), failedAtCap(makeSlot(3))]
    const { deps, telegram } = setup(slots)
    const first = await sweepCloudRenders(deps)
    expect(first.summaries).toBe(1)
    expect(telegram).toHaveBeenCalledTimes(1)
    const msg = telegram.mock.calls[0][0]
    expect(msg).toContain("Rendered: 6")
    expect(msg).toContain("Failed: 1")
    expect(msg).toContain("#3 materialize: image 404")
    expect(msg).toContain("⚠️ <b>Stories rendered for 2026-11-07</b> (cloud)")
    expect(msg).toContain(
      '<a href="https://admin.example/app/stories/2026-11-07">Open in admin</a>',
    )
    const second = await sweepCloudRenders(deps)
    expect(second.summaries).toBe(0)
    expect(telegram).toHaveBeenCalledTimes(1)
  })

  it("an all-green plan says no failures and omits the failure block", async () => {
    const { deps, telegram } = setup(sixDone())
    await sweepCloudRenders(deps)
    const msg = telegram.mock.calls[0][0]
    expect(msg.startsWith("✅")).toBe(true)
    expect(msg).not.toContain("Failed:")
    expect(msg).not.toContain("Failures:")
  })

  it("caps failure lines at 5, cuts long messages and escapes html", async () => {
    const slots = [1, 2, 3, 4, 5, 6, 7].map((i) =>
      failedAtCap(makeSlot(i), i === 1 ? "<b>" + "x".repeat(200) : "bad"),
    )
    const { deps, telegram } = setup(slots)
    await sweepCloudRenders(deps)
    const msg = telegram.mock.calls[0][0]
    expect(msg.startsWith("❌")).toBe(true)
    expect(msg).toContain("Failed: 7")
    expect(msg.match(/^• #/gm)).toHaveLength(5)
    expect(msg).toContain("…and 2 more")
    expect(msg).toContain("&lt;b&gt;")
    expect(msg).not.toContain("x".repeat(121))
  })

  it("a failed slot too late to post no longer blocks the summary", async () => {
    const late = withJob(
      makeSlot(3, { scheduled_at: new Date(NOW.getTime() - 130 * MIN) }),
      {
        state: "failed",
        dispatch_count: 1,
        resolved_at: new Date(NOW.getTime() - 2 * MIN).toISOString(),
      },
      { render_error: { message: "gone", name: "X", stage: "render" } },
    )
    const { deps, telegram, client } = setup([...sixDone(), late])
    await sweepCloudRenders(deps)
    expect(client.submit).not.toHaveBeenCalled()
    expect(telegram).toHaveBeenCalledTimes(1)
    expect(telegram.mock.calls[0][0]).toContain("Failed: 1")
  })

  it("summary send failure releases the claim and the next sweep sends it", async () => {
    const slots = sixDone()
    const { deps, telegram } = setup(slots)
    const errors = jest.spyOn(console, "error").mockImplementation(() => {})
    telegram.mockResolvedValueOnce({
      ok: false,
      status: 429,
      message: "secret body",
    })
    const first = await sweepCloudRenders(deps)
    expect(first.summaries).toBe(0)
    expect(slots.every((s) => s.metadata!.render_notified_job === null)).toBe(
      true,
    )
    const logged = errors.mock.calls.map((c) => String(c[0])).join("\n")
    errors.mockRestore()
    expect(JSON.parse(logged)).toEqual({
      msg: "[stories-render:sweep]",
      event: "summary_failed",
      plan_id: PLAN_ID,
      status: 429,
    })
    const second = await sweepCloudRenders(deps)
    expect(second.summaries).toBe(1)
    expect(telegram).toHaveBeenCalledTimes(2)
    const third = await sweepCloudRenders(deps)
    expect(third.summaries).toBe(0)
    expect(telegram).toHaveBeenCalledTimes(2)
  })

  it("a dormant telegram keeps the claims and does not count a summary", async () => {
    const slots = sixDone()
    const { deps, telegram } = setup(slots)
    telegram.mockResolvedValue({ ok: false, skipped: true })
    const out = await sweepCloudRenders(deps)
    expect(out.summaries).toBe(0)
    expect(slots[0].metadata!.render_notified_job).toBe(jobOf(slots[0]).job_id)
  })

  it("does not announce if another sweep already claimed the slot", async () => {
    const slot = done(makeSlot(1))
    const { deps, stories, telegram } = setup([slot])
    stories.updateSlotMetadataIfJob.mockResolvedValue(false)
    await sweepCloudRenders(deps)
    expect(telegram).not.toHaveBeenCalled()
  })
})

describe("sweepCloudRenders unsent alert", () => {
  const at = (min: number) => ({
    scheduled_at: new Date(NOW.getTime() + min * MIN),
  })
  // Failed below the cap and inside the retry gap, so this tick does not resend it.
  const failedBelowCap = (slot: Slot, meta: Patch = {}) =>
    withJob(
      slot,
      {
        state: "failed",
        dispatch_count: 0,
        resolved_at: new Date(NOW.getTime() - 2 * MIN).toISOString(),
      },
      {
        render_error: {
          message: "render service unavailable (timeout)",
          name: "CloudDispatchError",
          stage: "dispatch",
        },
        ...meta,
      },
    )
  const alertsSent = (telegram: jest.Mock) =>
    telegram.mock.calls
      .map((c) => c[0] as string)
      .filter((m) => m.includes("not sent yet"))
  // A slot with no render job that the sweep's dispatch would send.
  const neverSent = (min: number) =>
    makeSlot(3, {
      ...at(min),
      product_id: null,
      pick_attempt: 1,
      metadata: { forced_template_slug: "how-to-order" },
    })

  it("fires once at T−3h for a failed job below the cap", async () => {
    const slot = failedBelowCap(makeSlot(3, at(180)))
    const { deps, telegram, client } = setup([slot])
    const out = await sweepCloudRenders(deps)
    expect(client.submit).not.toHaveBeenCalled()
    expect(out.alerts).toBe(1)
    expect(telegram).toHaveBeenCalledTimes(1)
    expect(telegram.mock.calls[0][0]).toBe(
      [
        "⏰ <b>Story #3 for 2026-11-07 not sent yet</b> (cloud)",
        "",
        "Scheduled: 21:00 Mauritius time",
        "Reason: dispatch: render service unavailable (timeout)",
        "",
        '<a href="https://admin.example/app/stories/2026-11-07">Open in admin</a>',
      ].join("\n"),
    )
    expect(slot.metadata!.render_unsent_alert).toBe(jobOf(slot).job_id)
  })

  it("does not fire before T−3h", async () => {
    const { deps, telegram } = setup([failedBelowCap(makeSlot(3, at(181)))])
    const out = await sweepCloudRenders(deps)
    expect(out.alerts).toBe(0)
    expect(telegram).not.toHaveBeenCalled()
  })

  it("does not fire once the slot is too late to post", async () => {
    const { deps, telegram } = setup([failedBelowCap(makeSlot(3, at(-121)))])
    const out = await sweepCloudRenders(deps)
    expect(out.alerts).toBe(0)
    expect(alertsSent(telegram)).toEqual([])
  })

  it("does not fire twice across two ticks", async () => {
    const { deps, telegram } = setup([failedBelowCap(makeSlot(3, at(170)))])
    expect((await sweepCloudRenders(deps)).alerts).toBe(1)
    expect((await sweepCloudRenders(deps)).alerts).toBe(0)
    expect(telegram).toHaveBeenCalledTimes(1)
  })

  it("does not fire for a rendered slot", async () => {
    const slot = failedBelowCap(makeSlot(3, at(180)), {
      render: { mp4_url: "https://cdn.example.com/x.mp4", template_slug: "t" },
    })
    const { deps, telegram } = setup([slot])
    await sweepCloudRenders(deps)
    expect(telegram).not.toHaveBeenCalled()
  })

  it("does not fire for a posted slot", async () => {
    const slot = failedBelowCap(makeSlot(3, { ...at(180), posted_at: NOW }))
    const { deps, telegram } = setup([slot])
    await sweepCloudRenders(deps)
    expect(telegram).not.toHaveBeenCalled()
  })

  it("does not fire for a job at the send cap", async () => {
    const { deps, telegram } = setup([failedAtCap(makeSlot(3, at(180)))])
    const out = await sweepCloudRenders(deps)
    expect(out.alerts).toBe(0)
    expect(alertsSent(telegram)).toEqual([])
  })

  it("fires once for a slot with no render job that the sweep would send", async () => {
    const slot = neverSent(180)
    const { deps, telegram, stories, client } = setup([slot])
    // The dispatch stamp finds the slot changed, so nothing is sent this tick.
    stories.updateSlotMetadataIfUnchanged.mockResolvedValue(false)
    const out = await sweepCloudRenders(deps)
    expect(client.submit).not.toHaveBeenCalled()
    expect(out.alerts).toBe(1)
    expect(telegram.mock.calls[0][0]).toContain("Reason: never sent")
    expect(slot.metadata!.render_unsent_alert).toBe("no_job")
    expect(stories.claimSlotMetadata).toHaveBeenCalledWith(
      slot.id,
      "render_unsent_alert",
      "no_job",
      { jobId: null, product_id: null, pick_attempt: 1 },
    )
    expect((await sweepCloudRenders(deps)).alerts).toBe(0)
    expect(telegram).toHaveBeenCalledTimes(1)
  })

  it("does not fire for a slot with no render job that the sweep skips", async () => {
    // No product, no forced template: the dispatcher never sends it.
    const { deps, telegram } = setup([makeSlot(3, at(180))])
    await sweepCloudRenders(deps)
    expect(telegram).not.toHaveBeenCalled()
  })

  it("a real Telegram failure releases the claim and the next tick alerts", async () => {
    const slot = failedBelowCap(makeSlot(3, at(180)))
    const { deps, telegram } = setup([slot])
    const errors = jest.spyOn(console, "error").mockImplementation(() => {})
    telegram.mockResolvedValueOnce({ ok: false, status: 500, message: "secret body" })
    const first = await sweepCloudRenders(deps)
    const logged = errors.mock.calls.map((c) => String(c[0])).join("\n")
    errors.mockRestore()
    expect(first.alerts).toBe(0)
    expect(slot.metadata!.render_unsent_alert).toBeNull()
    expect(JSON.parse(logged)).toEqual({
      msg: "[stories-render:sweep]",
      event: "unsent_alert_failed",
      slot_id: slot.id,
      status: 500,
    })
    expect((await sweepCloudRenders(deps)).alerts).toBe(1)
    expect(telegram).toHaveBeenCalledTimes(2)
  })

  it("a dormant Telegram keeps the claim", async () => {
    const slot = failedBelowCap(makeSlot(3, at(180)))
    const { deps, telegram } = setup([slot])
    telegram.mockResolvedValue({ ok: false, skipped: true })
    expect((await sweepCloudRenders(deps)).alerts).toBe(0)
    expect(slot.metadata!.render_unsent_alert).toBe(jobOf(slot).job_id)
    await sweepCloudRenders(deps)
    expect(telegram).toHaveBeenCalledTimes(1)
  })

  it("one alert across ticks that each re-send and rewrite render_job", async () => {
    // Outage: the gap since the last failure is over, so every tick re-sends and
    // `unavailable` rewrites render_job whole (same job id). A claim kept inside
    // render_job would be wiped by that rewrite and alert again on every retry.
    const slot = failedBelowCap(makeSlot(3, at(180)), {})
    jobOf(slot).resolved_at = new Date(NOW.getTime() - 11 * MIN).toISOString()
    const jobId = jobOf(slot).job_id
    const { deps, telegram, client } = setup([slot])
    client.submit.mockResolvedValue({ kind: "unavailable", reason: "timeout" } as never)

    let clock = NOW
    deps.now = () => clock
    const first = await sweepCloudRenders(deps)
    expect(client.submit).toHaveBeenCalledTimes(1)
    expect(first.alerts).toBe(1)

    clock = new Date(NOW.getTime() + 11 * MIN)
    const second = await sweepCloudRenders(deps)
    expect(client.submit).toHaveBeenCalledTimes(2)
    expect(jobOf(slot).job_id).toBe(jobId)
    expect(jobOf(slot).resolved_at).toBe(clock.toISOString())
    expect(second.alerts).toBe(0)
    expect(alertsSent(telegram)).toHaveLength(1)
  })

  it("does not alert when another tick won the claim", async () => {
    const { deps, stories, telegram } = setup([failedBelowCap(makeSlot(3, at(180)))])
    stories.claimSlotMetadata.mockResolvedValue(false)
    await sweepCloudRenders(deps)
    expect(stories.claimSlotMetadata).toHaveBeenCalledTimes(1)
    expect(telegram).not.toHaveBeenCalled()
  })
})
