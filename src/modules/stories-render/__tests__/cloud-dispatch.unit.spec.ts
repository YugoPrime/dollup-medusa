import type { MedusaContainer } from "@medusajs/framework/types"

import type { ProductSnapshot } from "../../stories/snapshot"
import { planBatchSlots, type StorySlotRow } from "../batch"
import type { RemoteJob, SubmitResult } from "../cloud/client"
import {
  createCloudDeps,
  dispatchPlan,
  dispatchSlot,
  summarizeDispatch,
  type CloudDeps,
  type DispatchSlot,
} from "../cloud/dispatch"
import {
  buildCloudJob,
  MAX_SENDS_PER_SLOT,
  type CloudJobRequest,
} from "../cloud/job"
import { pickTemplate } from "../picker"
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

type Slot = DispatchSlot & { metadata: Record<string, unknown> | null }
type Call = { fn: string; args: unknown[] }
type Patch = Record<string, any>

function snapshot(): ProductSnapshot {
  return {
    name: "Test Dress",
    handle: "test-dress",
    price_mur: 1290,
    compare_at_price_mur: null,
    variants_in_stock: [
      {
        id: "blush",
        sku: "SKU-blush",
        color: "blush",
        color_code: null,
        sizes: ["S", "M"],
        image_urls: ["https://r2/blush.jpg"],
      },
    ],
    variant_in_stock_count: 1,
    is_new_arrival: false,
    picked_at: "2026-11-06T00:00:00.000Z",
  }
}

function makeSlot(id: string, slot_index: number, over: Partial<Slot> = {}): Slot {
  return {
    id,
    plan_id: PLAN_ID,
    slot_index,
    scheduled_at: new Date(NOW.getTime() + 60 * MIN),
    posted_at: null,
    metadata: null,
    product_snapshot: snapshot(),
    product_id: "prod_1",
    pick_attempt: 1,
    ...over,
  }
}

function renderJob(slot: Slot, over: Record<string, unknown> = {}) {
  const job = buildCloudJob(slot, REQ, "prod", CFG.callbackUrl)
  return {
    job_id: job.job_id,
    output_key: job.output_key,
    template_slug: REQ.template_slug,
    slot_inputs: REQ.slot_inputs,
    text_overrides: REQ.text_overrides,
    state: "failed",
    dispatch_count: 1,
    sent_at: new Date(NOW.getTime() - 30 * MIN).toISOString(),
    resolved_at: new Date(NOW.getTime() - 20 * MIN).toISOString(),
    ...over,
  }
}

// Inputs the real picker never produces for snapshot(): it has no back photo,
// so a cardflip pick is impossible. A retry that re-picked would change the job.
const STORED: RenderRequest = {
  template_slug: "cardflip-front-back",
  slot_inputs: { front: "https://r2/old.jpg", back: "https://r2/old-b.jpg" },
  text_overrides: { headline: "Old headline" },
}

function storedJob(slot: Slot, over: Record<string, unknown> = {}) {
  const job = buildCloudJob(slot, STORED, "prod", CFG.callbackUrl)
  return {
    job_id: job.job_id,
    output_key: job.output_key,
    template_slug: STORED.template_slug,
    slot_inputs: STORED.slot_inputs,
    text_overrides: STORED.text_overrides,
    state: "failed",
    dispatch_count: 1,
    sent_at: new Date(NOW.getTime() - 30 * MIN).toISOString(),
    resolved_at: new Date(NOW.getTime() - 11 * MIN).toISOString(),
    ...over,
  }
}

const jobOf = (s: Slot) => s.metadata!.render_job as Patch

function doneRemote(job: CloudJobRequest): RemoteJob {
  return {
    job_id: job.job_id,
    status: "done",
    attempts: 1,
    mp4_url: `https://cdn.example.com/${job.output_key}`,
    error: null,
    callback_state: "sent",
    updated_at: NOW.toISOString(),
  }
}

/**
 * Fake stories module + render client over in-memory slots. Metadata writes
 * merge top-level keys like the real jsonb `||`; guarded writes honour the
 * job id + state guard like the real SQL. Every call lands in `calls`, in order.
 */
function setup(
  slots: Slot[],
  submitResult: SubmitResult,
  getResult: (job: CloudJobRequest) => RemoteJob | "not_found" | "unavailable" = () =>
    "unavailable",
  onSubmit?: (job: CloudJobRequest) => void,
) {
  const calls: Call[] = []
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
      calls.push({ fn: "updateSlotMetadata", args: [id, patch] })
      merge(id, patch)
    }),
    updateSlotMetadataIfUnchanged: jest.fn(
      async (
        id: string,
        expected: { product_id: string | null; pick_attempt: number | null },
        patch: Patch,
      ) => {
        calls.push({ fn: "updateSlotMetadataIfUnchanged", args: [id, expected, patch] })
        const s = byId.get(id)
        if (
          !s ||
          s.product_id !== expected.product_id ||
          s.pick_attempt !== expected.pick_attempt
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
        calls.push({ fn: "updateSlotMetadataIfJob", args: [id, jobId, patch, state] })
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
  const submitted: CloudJobRequest[] = []
  const client = {
    submit: jest.fn(async (job: CloudJobRequest) => {
      calls.push({ fn: "submit", args: [job] })
      submitted.push(job)
      onSubmit?.(job)
      return submitResult
    }),
    get: jest.fn(async (jobId: string) => {
      calls.push({ fn: "get", args: [jobId] })
      const job = submitted.find((j) => j.job_id === jobId)
      return job ? getResult(job) : "not_found"
    }),
  }
  const deps: CloudDeps = {
    stories: stories as unknown as CloudDeps["stories"],
    client,
    cfg: CFG,
    now: () => NOW,
  }
  const writes = () =>
    calls.filter((c) => c.fn.startsWith("updateSlotMetadata")).map((c) =>
      c.fn === "updateSlotMetadata" ? (c.args[1] as Patch) : (c.args[2] as Patch),
    )
  return { deps, calls, stories, client, submitted, writes }
}

const QUEUED: SubmitResult = { kind: "accepted", status: "queued" }

describe("dispatchSlot (prod)", () => {
  it("dispatchSlot stamps the slot before it sends", async () => {
    const s = makeSlot("stslot_A1", 0)
    const t = setup([s], QUEUED)
    const job = buildCloudJob(s, REQ, "prod", CFG.callbackUrl)

    const out = await dispatchSlot(t.deps, s, REQ, { kind: "prod", manual: false })

    expect(out).toBe("sent")
    expect(t.calls.map((c) => c.fn)).toEqual(["updateSlotMetadataIfUnchanged", "submit"])
    expect(t.calls[0].args).toEqual([
      s.id,
      { product_id: "prod_1", pick_attempt: 1 },
      {
        render_started_at: NOW.toISOString(),
        render_template_slug: "in-stock-hero",
        render_error: null,
        render_job: {
          job_id: job.job_id,
          output_key: job.output_key,
          template_slug: "in-stock-hero",
          slot_inputs: REQ.slot_inputs,
          text_overrides: REQ.text_overrides,
          state: "sent",
          dispatch_count: 1,
          sent_at: NOW.toISOString(),
        },
      },
    ])
    expect(t.calls[1].args[0]).toEqual(job)
  })

  it("the same job counts up; a manual send starts at 1", async () => {
    async function countAfter(prevJobId: string | null, manual: boolean) {
      const s = makeSlot("stslot_A1", 0)
      s.metadata = {
        render_job: renderJob(s, {
          dispatch_count: 2,
          ...(prevJobId ? { job_id: prevJobId } : {}),
        }),
      }
      const t = setup([s], QUEUED)
      await dispatchSlot(t.deps, s, REQ, { kind: "prod", manual })
      return (t.calls[0].args[2] as Patch).render_job.dispatch_count
    }

    expect(await countAfter(null, false)).toBe(3)
    expect(await countAfter(null, true)).toBe(1)
    expect(await countAfter("stslot_A1_ffffffffffffffff", false)).toBe(1)
  })

  it("a refused job is never re-sent", async () => {
    const s = makeSlot("stslot_A1", 0)
    const t = setup([s], { kind: "rejected", httpStatus: 409, error: "job_id reused" })
    const job = buildCloudJob(s, REQ, "prod", CFG.callbackUrl)

    const out = await dispatchSlot(t.deps, s, REQ, { kind: "prod", manual: false })

    expect(out).toBe("rejected")
    const failed = t.calls.find((c) => c.fn === "updateSlotMetadataIfJob")!
    expect(failed.args[0]).toBe(s.id)
    expect(failed.args[1]).toBe(job.job_id)
    expect(failed.args[3]).toEqual({ is: "sent" })
    const patch = failed.args[2] as Patch
    expect(patch.render_error).toEqual({
      message: "render service refused the job (409 job_id reused)",
      name: "CloudDispatchError",
      stage: "dispatch",
      stderr_tail: null,
      failed_at: NOW.toISOString(),
    })
    expect(patch.render_started_at).toBeNull()
    expect(patch.render_job).toMatchObject({
      job_id: job.job_id,
      state: "failed",
      dispatch_count: MAX_SENDS_PER_SLOT,
      resolved_at: NOW.toISOString(),
    })
    expect(MAX_SENDS_PER_SLOT).toBe(3)
    expect((s.metadata!.render_job as Patch).dispatch_count).toBe(3)
  })

  it("an unreachable service leaves the slot retryable, and the send uncounted", async () => {
    // One earlier send of the same job: this send is stamped as the 2nd. It
    // never reached the service, so the count written back is the 1 from before.
    const s = makeSlot("stslot_A1", 0)
    s.metadata = { render_job: renderJob(s, { dispatch_count: 1 }) }
    const t = setup([s], { kind: "unavailable", reason: "TimeoutError" })

    const out = await dispatchSlot(t.deps, s, REQ, { kind: "prod", manual: false })

    expect(out).toBe("unavailable")
    expect((t.calls[0].args[2] as Patch).render_job.dispatch_count).toBe(2)
    const failed = t.calls.find((c) => c.fn === "updateSlotMetadataIfJob")!
    expect(failed.args[3]).toEqual({ is: "sent" })
    const patch = failed.args[2] as Patch
    expect(patch.render_error).toMatchObject({
      message: "render service unavailable (TimeoutError)",
      name: "CloudDispatchError",
      stage: "dispatch",
    })
    expect(patch.render_job).toMatchObject({ state: "failed", dispatch_count: 1 })
    expect((s.metadata!.render_job as Patch).dispatch_count).toBe(1)
  })

  it("an unreachable first send writes 0, never below", async () => {
    const s = makeSlot("stslot_A1", 0)
    const t = setup([s], { kind: "unavailable", reason: "http 503" })

    await dispatchSlot(t.deps, s, REQ, { kind: "prod", manual: true })

    expect((t.calls[0].args[2] as Patch).render_job.dispatch_count).toBe(1)
    expect(jobOf(s)).toMatchObject({ state: "failed", dispatch_count: 0 })
  })

  it("a slot changed since it was read is not sent", async () => {
    // Read with pick_attempt 1; a swap bumped the stored row to 2 since.
    const stored = makeSlot("stslot_A1", 0, { product_id: "prod_2", pick_attempt: 2 })
    const asRead = { ...stored, product_id: "prod_1", pick_attempt: 1 }
    const t = setup([stored], QUEUED)

    const out = await dispatchSlot(t.deps, asRead, REQ, { kind: "prod", manual: true })

    expect(out).toBe("changed")
    expect(t.calls.map((c) => c.fn)).toEqual(["updateSlotMetadataIfUnchanged"])
    expect(t.calls[0].args[1]).toEqual({ product_id: "prod_1", pick_attempt: 1 })
    expect(t.client.submit).not.toHaveBeenCalled()
    expect(stored.metadata).toBeNull()
  })

  it("a cleared slot (product_id now null) is not sent", async () => {
    const stored = makeSlot("stslot_A1", 0, { product_id: null })
    const asRead = { ...stored, product_id: "prod_1" }
    const t = setup([stored], QUEUED)

    expect(await dispatchSlot(t.deps, asRead, REQ, { kind: "prod", manual: false })).toBe(
      "changed",
    )
    expect(t.client.submit).not.toHaveBeenCalled()
  })

  it("a failure write never overwrites a callback that landed first", async () => {
    const s = makeSlot("stslot_A1", 0)
    // The service queued the job and its ok callback landed before the POST timed out.
    const t = setup([s], { kind: "unavailable", reason: "TimeoutError" }, undefined, () => {
      s.metadata = {
        ...s.metadata,
        render: { mp4_url: "https://cdn.example.com/x.mp4" },
        render_job: { ...(s.metadata!.render_job as Patch), state: "done" },
      }
    })

    const out = await dispatchSlot(t.deps, s, REQ, { kind: "prod", manual: false })

    expect(out).toBe("unavailable")
    expect((s.metadata!.render_job as Patch).state).toBe("done")
    expect(s.metadata!.render_error).toBeNull()
  })

  it("a job the service already finished is applied at once", async () => {
    const s = makeSlot("stslot_A1", 0)
    const t = setup([s], { kind: "accepted", status: "done" }, doneRemote)

    const out = await dispatchSlot(t.deps, s, REQ, { kind: "prod", manual: false })

    expect(out).toBe("applied")
    const job = t.submitted[0]
    expect(t.client.get).toHaveBeenCalledWith(job.job_id)
    const applied = t.calls.find((c) => c.fn === "updateSlotMetadataIfJob")!
    const patch = applied.args[2] as Patch
    expect(patch.render.mp4_url).toBe(`https://cdn.example.com/${job.output_key}`)
    expect(patch.render.template_slug).toBe("in-stock-hero")
    expect((s.metadata!.render_job as Patch).state).toBe("done")
  })

  it("a finished job whose status read fails stays sent for the sweeper", async () => {
    const s = makeSlot("stslot_A1", 0)
    const t = setup([s], { kind: "accepted", status: "done" }, () => "unavailable")

    const out = await dispatchSlot(t.deps, s, REQ, { kind: "prod", manual: false })

    expect(out).toBe("sent")
    expect(t.stories.updateSlotMetadataIfJob).not.toHaveBeenCalled()
    expect((s.metadata!.render_job as Patch).state).toBe("sent")
  })
})

describe("dispatchSlot (shadow)", () => {
  const cases: Array<[string, SubmitResult]> = [
    ["queued", QUEUED],
    ["done", { kind: "accepted", status: "done" }],
    ["rejected", { kind: "rejected", httpStatus: 400, error: "bad template" }],
    ["unavailable", { kind: "unavailable", reason: "http 503" }],
  ]

  it.each(cases)("shadow dispatch writes only render_shadow (%s)", async (_name, result) => {
    const s = makeSlot("stslot_A1", 0, { metadata: { render: { mp4_url: "https://x/laptop.mp4" } } })
    const t = setup([s], result, doneRemote)

    await dispatchSlot(t.deps, s, REQ, { kind: "shadow", manual: false })

    expect(t.writes().length).toBeGreaterThan(0)
    for (const patch of t.writes()) {
      expect(Object.keys(patch)).toEqual(["render_shadow"])
    }
    expect(t.submitted[0].job_id.startsWith("shadow_stslot_A1_")).toBe(true)
    expect(t.submitted[0].output_key.startsWith("stories-shadow/stslot_A1/")).toBe(true)
    expect(s.metadata!.render).toEqual({ mp4_url: "https://x/laptop.mp4" })
  })

  it("records the shadow outcome", async () => {
    const sent = makeSlot("stslot_A1", 0)
    const t1 = setup([sent], QUEUED)
    expect(await dispatchSlot(t1.deps, sent, REQ, { kind: "shadow", manual: false })).toBe("sent")
    expect(sent.metadata!.render_shadow).toMatchObject({ state: "sent", sent_at: NOW.toISOString() })

    const done = makeSlot("stslot_A2", 1)
    const t2 = setup([done], { kind: "accepted", status: "done" }, doneRemote)
    expect(await dispatchSlot(t2.deps, done, REQ, { kind: "shadow", manual: false })).toBe("applied")
    expect(done.metadata!.render_shadow).toMatchObject({
      state: "done",
      mp4_url: `https://cdn.example.com/${t2.submitted[0].output_key}`,
    })

    const refused = makeSlot("stslot_A3", 2)
    const t3 = setup([refused], { kind: "rejected", httpStatus: 400, error: "bad template" })
    expect(await dispatchSlot(t3.deps, refused, REQ, { kind: "shadow", manual: false })).toBe(
      "rejected",
    )
    expect(refused.metadata!.render_shadow).toMatchObject({
      state: "failed",
      stage: "dispatch",
      message: "render service refused the job (400 bad template)",
      resolved_at: NOW.toISOString(),
    })
  })
})

describe("dispatchPlan", () => {
  it("dispatchPlan skips posted, rendered, in-flight and given-up slots", async () => {
    const posted = makeSlot("stslot_P0", 0, { posted_at: NOW })
    const rendered = makeSlot("stslot_R1", 1, {
      metadata: {
        render: { template_slug: "product-2colors", mp4_url: "https://x/r1.mp4" },
      },
    })
    const inFlight = makeSlot("stslot_F2", 2)
    inFlight.metadata = {
      render_job: renderJob(inFlight, { state: "sent", template_slug: "cardflip-front-back" }),
    }
    const gaveUp = makeSlot("stslot_G3", 3)
    gaveUp.metadata = { render_job: renderJob(gaveUp, { dispatch_count: MAX_SENDS_PER_SLOT }) }
    const fresh = makeSlot("stslot_N4", 4)
    // Out of order on purpose: results come back by slot_index.
    const t = setup([fresh, gaveUp, inFlight, rendered, posted], QUEUED)

    const results = await dispatchPlan(t.deps, PLAN_ID, { kind: "prod" })

    expect(results.map((r) => [r.slot_index, r.status, r.reason])).toEqual([
      [0, "skipped", "already posted"],
      [1, "skipped", "already rendered"],
      [2, "skipped", "in flight"],
      [3, "skipped", "gave up"],
      [4, "sent", undefined],
    ])
    expect(results[1].template_slug).toBe("product-2colors")
    expect(results[2].template_slug).toBe("cardflip-front-back")
    expect(typeof results[4].template_slug).toBe("string")
    expect(t.client.submit).toHaveBeenCalledTimes(1)
    expect(t.submitted[0].audio).toEqual({ pool: "dollup", seed: PLAN_ID, index: 4 })
  })

  it("a manual run re-sends a slot that gave up, starting at 1", async () => {
    const gaveUp = makeSlot("stslot_G3", 3)
    gaveUp.metadata = { render_job: renderJob(gaveUp, { dispatch_count: MAX_SENDS_PER_SLOT }) }
    const t = setup([gaveUp], QUEUED)

    const results = await dispatchPlan(t.deps, PLAN_ID, { kind: "prod", manual: true })

    expect(results.map((r) => r.status)).toEqual(["sent"])
    expect((gaveUp.metadata!.render_job as Patch).dispatch_count).toBe(1)
  })

  it("the sweep waits 10 minutes before re-sending a failure", async () => {
    const failedAgo = (min: number) => {
      const s = makeSlot("stslot_W1", 0)
      s.metadata = {
        render_job: renderJob(s, {
          resolved_at: new Date(NOW.getTime() - min * MIN).toISOString(),
        }),
      }
      return s
    }

    const recent = failedAgo(9)
    const t1 = setup([recent], QUEUED)
    const r1 = await dispatchPlan(t1.deps, PLAN_ID, { kind: "prod", sweep: true })
    expect(r1.map((r) => [r.status, r.reason])).toEqual([["skipped", "retry later"]])
    expect(t1.client.submit).not.toHaveBeenCalled()

    const older = failedAgo(11)
    const t2 = setup([older], QUEUED)
    const r2 = await dispatchPlan(t2.deps, PLAN_ID, { kind: "prod", sweep: true })
    expect(r2.map((r) => r.status)).toEqual(["sent"])
  })

  it("a sweep retry re-sends the stored job and counts up", async () => {
    const s = makeSlot("stslot_W1", 0)
    s.metadata = { render_job: storedJob(s) }
    const stored = buildCloudJob(s, STORED, "prod", CFG.callbackUrl)
    expect(pickTemplate(snapshot(), 0, new Map())?.template_slug).not.toBe(STORED.template_slug)
    const t = setup([s], QUEUED)
    // The service took the job and its render failed, as its error callback writes it.
    const renderFails = (at: Date) => {
      s.metadata = {
        ...s.metadata,
        render_job: { ...jobOf(s), state: "failed", resolved_at: at.toISOString() },
      }
    }

    const r1 = await dispatchPlan(t.deps, PLAN_ID, { kind: "prod", sweep: true })
    expect(r1).toEqual([
      {
        slot_id: s.id,
        slot_index: 0,
        status: "sent",
        template_slug: STORED.template_slug,
      },
    ])
    expect(t.submitted[0]).toEqual(stored)
    expect(jobOf(s)).toMatchObject({ job_id: stored.job_id, state: "sent", dispatch_count: 2 })
    renderFails(NOW)

    t.deps.now = () => new Date(NOW.getTime() + 11 * MIN)
    await dispatchPlan(t.deps, PLAN_ID, { kind: "prod", sweep: true })
    expect(t.submitted[1].job_id).toBe(stored.job_id)
    expect(jobOf(s)).toMatchObject({ job_id: stored.job_id, state: "sent", dispatch_count: 3 })
    renderFails(new Date(NOW.getTime() + 11 * MIN))

    t.deps.now = () => new Date(NOW.getTime() + 22 * MIN)
    const r3 = await dispatchPlan(t.deps, PLAN_ID, { kind: "prod", sweep: true })
    expect(r3.map((r) => [r.status, r.reason])).toEqual([["skipped", "gave up"]])
    expect(t.client.submit).toHaveBeenCalledTimes(2)
  })

  it("sends that never reach the service keep retrying until too late to post", async () => {
    // Scheduled 60 min after NOW, so too late to post from NOW + 180 min.
    const s = makeSlot("stslot_W1", 0)
    s.metadata = { render_job: storedJob(s) }
    const stored = buildCloudJob(s, STORED, "prod", CFG.callbackUrl)
    const t = setup([s], { kind: "unavailable", reason: "http 503" })

    for (let i = 1; i <= 4; i++) {
      t.deps.now = () => new Date(NOW.getTime() + i * 11 * MIN)
      const r = await dispatchPlan(t.deps, PLAN_ID, { kind: "prod", sweep: true })
      expect(r.map((x) => [x.status, x.reason])).toEqual([["unavailable", undefined]])
      expect(jobOf(s)).toMatchObject({ job_id: stored.job_id, state: "failed", dispatch_count: 1 })
    }
    expect(t.client.submit).toHaveBeenCalledTimes(4)
    expect(t.submitted.every((j) => j.job_id === stored.job_id)).toBe(true)

    t.deps.now = () => new Date(NOW.getTime() + 181 * MIN)
    const late = await dispatchPlan(t.deps, PLAN_ID, { kind: "prod", sweep: true })
    expect(late.map((x) => [x.status, x.reason])).toEqual([["skipped", "too late to post"]])
    expect(t.client.submit).toHaveBeenCalledTimes(4)
  })

  it("a slot changed while sending is reported skipped, and the plan goes on", async () => {
    const a = makeSlot("stslot_C0", 0)
    const b = makeSlot("stslot_C1", 1)
    const t = setup([a, b], QUEUED)
    t.stories.updateSlotMetadataIfUnchanged.mockResolvedValueOnce(false)

    const r = await dispatchPlan(t.deps, PLAN_ID, { kind: "prod" })

    expect(r[0]).toEqual({
      slot_id: "stslot_C0",
      slot_index: 0,
      status: "skipped",
      reason: "slot changed while sending",
    })
    expect(r[1].status).toBe("sent")
    expect(t.submitted.map((j) => j.job_id.startsWith("stslot_C1_"))).toEqual([true])
    expect(summarizeDispatch(r)).toEqual({ sent: 1, skipped: 1, failed: 0 })
  })

  it("a manual call re-picks a failed slot and resets the count", async () => {
    const s = makeSlot("stslot_M1", 0)
    s.metadata = { render_job: storedJob(s, { dispatch_count: 2 }) }
    const stored = buildCloudJob(s, STORED, "prod", CFG.callbackUrl)
    const t = setup([s], QUEUED)

    const r = await dispatchPlan(t.deps, PLAN_ID, { kind: "prod", manual: true })

    expect(r.map((x) => x.status)).toEqual(["sent"])
    expect(r[0].template_slug).not.toBe(STORED.template_slug)
    expect(t.submitted[0].job_id).not.toBe(stored.job_id)
    expect(jobOf(s)).toMatchObject({ job_id: t.submitted[0].job_id, dispatch_count: 1 })
  })

  it("one slot's error does not stop the plan", async () => {
    const a = makeSlot("stslot_X0", 0)
    const b = makeSlot("stslot_X1", 1)
    const t = setup([a, b], QUEUED)
    t.stories.updateSlotMetadataIfUnchanged.mockImplementationOnce(async () => {
      throw new Error("db down")
    })
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => undefined)
    try {
      const r = await dispatchPlan(t.deps, PLAN_ID, { kind: "prod" })

      expect(r.map((x) => [x.slot_index, x.status, x.reason])).toEqual([
        [0, "unavailable", "error: db down"],
        [1, "sent", undefined],
      ])
      expect(t.submitted.map((j) => j.job_id.startsWith("stslot_X1_"))).toEqual([true])
      expect(errSpy).toHaveBeenCalledTimes(1)
      expect(JSON.parse(errSpy.mock.calls[0][0] as string)).toEqual({
        msg: "[stories-render:dispatch]",
        event: "slot_error",
        slot_id: "stslot_X0",
        message: "db down",
      })
    } finally {
      errSpy.mockRestore()
    }
  })

  it("the sweep never renders a slot too late to post", async () => {
    const late = () =>
      makeSlot("stslot_L1", 0, { scheduled_at: new Date(NOW.getTime() - 180 * MIN) })

    const t1 = setup([late()], QUEUED)
    const r1 = await dispatchPlan(t1.deps, PLAN_ID, { kind: "prod", sweep: true })
    expect(r1.map((r) => [r.status, r.reason])).toEqual([["skipped", "too late to post"]])
    expect(t1.client.submit).not.toHaveBeenCalled()

    // Only the sweep applies the publish window; an explicit run still sends.
    const t2 = setup([late()], QUEUED)
    const r2 = await dispatchPlan(t2.deps, PLAN_ID, { kind: "prod" })
    expect(r2.map((r) => r.status)).toEqual(["sent"])
  })

  it("shadow adds no skips of its own", async () => {
    const inFlight = makeSlot("stslot_F2", 0)
    inFlight.metadata = { render_job: renderJob(inFlight, { state: "sent" }) }
    const t = setup([inFlight], QUEUED)

    const results = await dispatchPlan(t.deps, PLAN_ID, { kind: "shadow" })

    expect(results.map((r) => r.status)).toEqual(["sent"])
    expect(t.submitted[0].job_id.startsWith("shadow_")).toBe(true)
  })

  it("throws for an unknown plan", async () => {
    const t = setup([], QUEUED)
    await expect(dispatchPlan(t.deps, "stplan_missing", { kind: "prod" })).rejects.toThrow(
      "Plan not found: stplan_missing",
    )
  })
})

describe("summarizeDispatch", () => {
  it("counts applied as sent, changed as skipped, and rejected + unavailable as failed", () => {
    const r = (
      status: "sent" | "applied" | "rejected" | "unavailable" | "changed" | "skipped",
    ) => ({
      slot_id: "s",
      slot_index: 0,
      status,
    })
    expect(
      summarizeDispatch([
        r("sent"),
        r("applied"),
        r("skipped"),
        r("rejected"),
        r("unavailable"),
        r("skipped"),
        r("changed"),
      ]),
    ).toEqual({ sent: 2, skipped: 3, failed: 2 })
  })
})

describe("createCloudDeps", () => {
  const KEYS = [
    "STORY_RENDER_URL",
    "STORY_RENDER_API_KEY",
    "STORY_RENDER_CALLBACK_SECRET",
    "STORY_RENDER_CALLBACK_URL",
  ]
  let saved: Record<string, string | undefined>
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
    for (const k of KEYS) delete process.env[k]
  })
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it("throws the config error unchanged", () => {
    const scope = { resolve: jest.fn() } as unknown as MedusaContainer
    expect(() => createCloudDeps(scope)).toThrow("STORY_RENDER_URL is not set")
  })

  it("wires the stories module, config, client and clock", () => {
    process.env.STORY_RENDER_URL = "https://render.example/"
    process.env.STORY_RENDER_API_KEY = "k"
    process.env.STORY_RENDER_CALLBACK_SECRET = "s"
    const stories = { marker: true }
    const resolve = jest.fn(() => stories)
    const deps = createCloudDeps({ resolve } as unknown as MedusaContainer)

    expect(resolve).toHaveBeenCalledWith("stories")
    expect(deps.stories).toBe(stories)
    expect(deps.cfg.baseUrl).toBe("https://render.example")
    expect(typeof deps.client.submit).toBe("function")
    expect(deps.now()).toBeInstanceOf(Date)
  })
})

describe("planBatchSlots", () => {
  const row = (s: Slot) => s as unknown as StorySlotRow

  it("keeps today's checks and messages, in today's order", () => {
    const posted = makeSlot("stslot_P0", 0, {
      posted_at: NOW,
      metadata: { render: { template_slug: "a", mp4_url: "https://x/0.mp4" } },
    })
    const rendered = makeSlot("stslot_R1", 1, {
      metadata: { render: { template_slug: "product-2colors", mp4_url: "https://x/1.mp4" } },
    })
    const skipped = makeSlot("stslot_S2", 2, { metadata: { skip_me: true } })
    const forced = makeSlot("stslot_T3", 3, {
      product_snapshot: null,
      metadata: { forced_template_slug: "how-to-order" },
    })
    const noProduct = makeSlot("stslot_E4", 4, { product_snapshot: null })
    const noPhotos = makeSlot("stslot_E5", 5, {
      product_snapshot: { ...snapshot(), variants_in_stock: [], variant_in_stock_count: 0 },
    })
    const picks = makeSlot("stslot_K6", 6)
    const all = [picks, noPhotos, noProduct, forced, skipped, rendered, posted].map(row)
    const skip = jest.fn((slot: StorySlotRow) =>
      (slot.metadata as Patch | null)?.skip_me ? { reason: "custom", template_slug: "x" } : null,
    )

    const plan = planBatchSlots(all, { force: false, skip })

    expect(plan.map((p) => ("skip" in p ? p.skip : `pick:${p.picked.template_slug}`))).toEqual([
      "already posted",
      "already rendered",
      "custom",
      "pick:how-to-order",
      "no product picked for this slot",
      "no in-stock photos to render",
      expect.stringMatching(/^pick:/),
    ])
    expect(plan[1]).toMatchObject({ template_slug: "product-2colors", mp4_url: "https://x/1.mp4" })
    expect(plan[2]).toMatchObject({ skip: "custom", template_slug: "x" })
    expect(plan[3]).toMatchObject({
      picked: { template_slug: "how-to-order", slot_inputs: {}, text_overrides: {} },
    })
    // The skip rule is never asked about posted or kept-rendered slots.
    expect(skip.mock.calls.map(([s]) => s.id)).not.toContain("stslot_P0")
    expect(skip.mock.calls.map(([s]) => s.id)).not.toContain("stslot_R1")
    // Pure: the caller's array is not reordered.
    expect(all[0].id).toBe("stslot_K6")
  })

  it("force re-picks rendered slots but never posted ones", () => {
    const posted = makeSlot("stslot_P0", 0, { posted_at: NOW })
    const rendered = makeSlot("stslot_R1", 1, {
      metadata: { render: { template_slug: "product-2colors", mp4_url: "https://x/1.mp4" } },
    })

    const plan = planBatchSlots([posted, rendered].map(row), { force: true })

    expect("skip" in plan[0] && plan[0].skip).toBe("already posted")
    expect("picked" in plan[1]).toBe(true)
  })
})
