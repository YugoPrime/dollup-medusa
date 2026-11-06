// jest.mock is file-wide, so the template-cap tests live apart from the
// other dispatch tests, which use the real picker.
jest.mock("../picker")

import { planBatchSlots, type StorySlotRow } from "../batch"
import type { CloudDeps } from "../cloud/dispatch"
import { dispatchPlan } from "../cloud/dispatch"
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

const inFlight = (id: string, slot_index: number) =>
  makeSlot(id, slot_index, {
    render_job: {
      job_id: `${id}_0123456789abcdef`,
      output_key: `stories/${id}/0123456789abcdef.mp4`,
      template_slug: HERO,
      slot_inputs: {},
      text_overrides: {},
      state: "sent",
      dispatch_count: 1,
      sent_at: NOW.toISOString(),
    },
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
      callbackUrl: "https://shop.example/hooks/story-render",
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
