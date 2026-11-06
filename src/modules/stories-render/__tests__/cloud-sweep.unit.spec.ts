import type { RemoteJob } from "../cloud/client"
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
    // far enough in the future that dispatch has nothing to do with it
    scheduled_at: new Date(NOW.getTime() + 120 * MIN),
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
  }
  const client = {
    submit: jest.fn(),
    get: jest.fn(async (jobId: string) => {
      const s = slots.find((x) => jobOf(x)?.job_id === jobId)
      return s ? getResult(s) : "not_found"
    }),
  }
  const telegram = jest.fn(async (_html: string) => {})
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
    expect(jobOf(slot).state).toBe("sent")
  })

  it("a job the service lost becomes retryable", async () => {
    const slot = withJob(makeSlot(1), { dispatch_count: 2 })
    const { deps } = setup([slot], () => "not_found")
    await sweepCloudRenders(deps)
    expect(jobOf(slot)).toMatchObject({
      state: "failed",
      dispatch_count: 2,
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
    const { deps, stories } = setup([slot], () => "unavailable")
    const out = await sweepCloudRenders(deps)
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

  it("does not announce if another sweep already claimed the slot", async () => {
    const slot = done(makeSlot(1))
    const { deps, stories, telegram } = setup([slot])
    stories.updateSlotMetadataIfJob.mockResolvedValue(false)
    await sweepCloudRenders(deps)
    expect(telegram).not.toHaveBeenCalled()
  })
})
