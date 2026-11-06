// jest.mock is file-wide, so the template-cap tests live apart from the
// other dispatch tests, which use the real picker.
jest.mock("../picker")

import { planBatchSlots, type StorySlotRow } from "../batch"
import type { CloudDeps } from "../cloud/dispatch"
import { dispatchPlan } from "../cloud/dispatch"
import { buildCloudJob } from "../cloud/job"
import { pickTemplate } from "../picker"

const NOW = new Date("2026-11-06T14:00:00.000Z")
const PLAN_ID = "stplan_1"
const HERO = "in-stock-hero"

const pickMock = pickTemplate as jest.MockedFunction<typeof pickTemplate>

type Slot = {
  id: string
  plan_id: string
  slot_index: number
  scheduled_at: Date
  posted_at: Date | null
  metadata: Record<string, unknown> | null
  product_snapshot: unknown
}

function makeSlot(id: string, slot_index: number, metadata: Slot["metadata"] = null): Slot {
  return {
    id,
    plan_id: PLAN_ID,
    slot_index,
    scheduled_at: new Date(NOW.getTime() + 3_600_000),
    posted_at: null,
    metadata,
    product_snapshot: { name: "Dress" },
  }
}

const CALLBACK_URL = "https://shop.example/hooks/story-render"
const STORED_REQ = {
  template_slug: HERO,
  slot_inputs: { hero: "https://r2/old.jpg" },
  text_overrides: {},
}

function withJob(id: string, slot_index: number, over: Record<string, unknown>): Slot {
  const slot = makeSlot(id, slot_index)
  const job = buildCloudJob(slot, STORED_REQ, "prod", CALLBACK_URL)
  slot.metadata = {
    render_job: {
      job_id: job.job_id,
      output_key: job.output_key,
      ...STORED_REQ,
      state: "sent",
      dispatch_count: 1,
      sent_at: NOW.toISOString(),
      ...over,
    },
  }
  return slot
}

const inFlight = (id: string, slot_index: number) => withJob(id, slot_index, {})

const failedAgo = (id: string, slot_index: number, minutes: number) =>
  withJob(id, slot_index, {
    state: "failed",
    resolved_at: new Date(NOW.getTime() - minutes * 60_000).toISOString(),
  })

/** Records the in-stock-hero count the picker saw at the moment of each pick. */
function captureHeroCounts(): number[] {
  const seen: number[] = []
  pickMock.mockImplementation((_snapshot, _index, pickedSoFar) => {
    seen.push(pickedSoFar?.get(HERO) ?? 0)
    return { template_slug: HERO, slot_inputs: { hero: "https://r2/a.jpg" }, text_overrides: {} }
  })
  return seen
}

function deps(slots: Slot[]): CloudDeps {
  const stories = {
    listStoryPlans: jest.fn(async () => [{ id: PLAN_ID }]),
    listStorySlots: jest.fn(async () => slots),
    updateSlotMetadata: jest.fn(async () => undefined),
    updateSlotMetadataIfUnchanged: jest.fn(async () => true),
    updateSlotMetadataIfJob: jest.fn(async () => true),
  }
  return {
    stories: stories as unknown as CloudDeps["stories"],
    client: {
      submit: jest.fn(async () => ({ kind: "accepted" as const, status: "queued" as const })),
      get: jest.fn(async () => "unavailable" as const),
    },
    cfg: {
      baseUrl: "https://render.example",
      apiKey: "k",
      callbackSecret: "s",
      callbackUrl: CALLBACK_URL,
    },
    now: () => NOW,
  }
}

beforeEach(() => pickMock.mockReset())

describe("template cap", () => {
  it("in-flight templates count toward the daily template cap", async () => {
    const seen = captureHeroCounts()
    const slots = [inFlight("stslot_F0", 0), inFlight("stslot_F1", 1), makeSlot("stslot_N2", 2)]

    const results = await dispatchPlan(deps(slots), PLAN_ID, { kind: "prod" })

    expect(results.map((r) => r.status)).toEqual(["skipped", "skipped", "sent"])
    expect(pickMock).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([2])
  })

  it("counts in-flight templates even when those slots come later in the day", async () => {
    const seen = captureHeroCounts()
    const slots = [makeSlot("stslot_N0", 0), inFlight("stslot_F1", 1), inFlight("stslot_F2", 2)]

    await dispatchPlan(deps(slots), PLAN_ID, { kind: "prod" })

    expect(seen).toEqual([2])
  })

  it("a waiting failure keeps its template in the cap", async () => {
    const seen = captureHeroCounts()
    // Slot 0 failed 5 min ago (waits), slot 1 failed 20 min ago (re-sent as stored).
    const waiting = failedAgo("stslot_W0", 0, 5)
    const retried = failedAgo("stslot_R1", 1, 20)
    const d = deps([waiting, retried, makeSlot("stslot_N2", 2)])

    const results = await dispatchPlan(d, PLAN_ID, { kind: "prod", sweep: true })

    expect(results.map((r) => [r.status, r.reason, r.template_slug])).toEqual([
      ["skipped", "retry later", HERO],
      ["sent", undefined, HERO],
      ["sent", undefined, HERO],
    ])
    // Failed slots are not re-picked; both still count when slot 2 is picked.
    expect(pickMock).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([2])
    const submit = d.client.submit as jest.Mock
    expect(submit.mock.calls[0][0].job_id).toBe(
      buildCloudJob(retried, STORED_REQ, "prod", CALLBACK_URL).job_id,
    )
  })

  it("planBatchSlots counts kept renders and skip templates together", () => {
    const seen = captureHeroCounts()
    const kept = makeSlot("stslot_K0", 0, {
      render: { template_slug: HERO, mp4_url: "https://x/k0.mp4" },
    })
    const held = makeSlot("stslot_H1", 1, { hold: true })
    const fresh = makeSlot("stslot_N2", 2)
    const rows = [kept, held, fresh] as unknown as StorySlotRow[]

    planBatchSlots(rows, {
      force: false,
      skip: (slot) =>
        (slot.metadata as Record<string, unknown> | null)?.hold
          ? { reason: "held", template_slug: HERO }
          : null,
    })

    expect(seen).toEqual([2])
  })

  it("a forced re-render does not count the renders it replaces", () => {
    const seen = captureHeroCounts()
    const kept = makeSlot("stslot_K0", 0, {
      render: { template_slug: HERO, mp4_url: "https://x/k0.mp4" },
    })
    const rows = [kept] as unknown as StorySlotRow[]

    planBatchSlots(rows, { force: true })

    expect(seen).toEqual([0])
  })
})
