import { resolveRenderMode } from "../cloud/mode"
import {
  createCloudDeps,
  dispatchPlan,
  dispatchSlot,
  summarizeDispatch,
} from "../cloud/dispatch"
import { sendTelegram } from "../../../lib/telegram"

import { POST as renderPost } from "../../../api/admin/stories/slots/[id]/render/route"
import { POST as autoRenderPost } from "../../../api/admin/stories/slots/[id]/auto-render/route"
import { POST as batchRenderPost } from "../../../api/admin/stories/plans/[id]/batch-render/route"
import { POST as renderSamplePost } from "../../../api/admin/stories/templates/[slug]/render-sample/route"
import { POST as shadowRenderPost } from "../../../api/admin/stories/plans/[id]/shadow-render/route"
import createTomorrowPlan from "../../../jobs/create-tomorrow-plan"

jest.mock("../cloud/mode", () => ({ resolveRenderMode: jest.fn() }))
jest.mock("../cloud/dispatch", () => ({
  createCloudDeps: jest.fn(),
  dispatchSlot: jest.fn(),
  dispatchPlan: jest.fn(),
  summarizeDispatch: jest.fn(),
}))
jest.mock("../../../lib/telegram", () => ({
  ...jest.requireActual("../../../lib/telegram"),
  sendTelegram: jest.fn(async () => ({ ok: true })),
}))
jest.mock("../../../lib/story-pick-deps", () => ({
  createStoryPickDeps: jest.fn(() => ({ productSource: jest.fn() })),
}))
jest.mock("../picker", () => ({
  pickTemplate: jest.fn(() => ({
    template_slug: "picked",
    slot_inputs: { a: "x" },
    text_overrides: {},
  })),
}))
jest.mock("../../../lib/r2-story-uploader", () => ({
  uploadStoryRenderToR2: jest.fn(),
}))

const mode = resolveRenderMode as jest.Mock
const deps = { fake: "deps" }
const slot = {
  id: "slot_1",
  plan_id: "plan_1",
  slot_index: 2,
  posted_at: null,
  product_snapshot: null,
  metadata: null,
}

function fakeRes() {
  const out: { status?: number; body?: any } = {}
  const res: any = {
    status: (s: number) => {
      out.status = s
      return res
    },
    json: (b: any) => {
      out.body = b
      return res
    },
  }
  return { res, out }
}

function fakeReq(
  services: Record<string, any>,
  params: Record<string, string>,
  body: any = {},
) {
  return {
    params,
    body,
    scope: {
      resolve: (key: string) => {
        if (key in services) return services[key]
        return { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
      },
    },
  } as any
}

const STORIES_KEY = "stories"

beforeEach(() => {
  jest.clearAllMocks()
  ;(createCloudDeps as jest.Mock).mockReturnValue(deps)
  ;(dispatchSlot as jest.Mock).mockResolvedValue("sent")
  ;(dispatchPlan as jest.Mock).mockResolvedValue([])
  ;(summarizeDispatch as jest.Mock).mockReturnValue({
    sent: 0,
    skipped: 0,
    failed: 0,
  })
})

describe("cloud call sites", () => {
  it("render route in cloud mode sends the chosen template and inputs", async () => {
    mode.mockReturnValue("cloud")
    const stories = {
      listStorySlots: jest.fn(async () => [slot]),
      updateSlotMetadata: jest.fn(),
    }
    const { res, out } = fakeRes()
    await renderPost(
      fakeReq(
        { [STORIES_KEY]: stories },
        { id: "slot_1" },
        {
          template_slug: "hero",
          slot_inputs: { a: "x" },
          text_overrides: { headline: "Hi" },
        },
      ),
      res,
    )
    expect(dispatchSlot).toHaveBeenCalledWith(
      deps,
      slot,
      {
        template_slug: "hero",
        slot_inputs: { a: "x" },
        text_overrides: { headline: "Hi" },
        plan_id: "plan_1",
        slot_index: 2,
      },
      { kind: "prod", manual: true },
    )
    expect(out.status).toBe(202)
    expect(out.body).toMatchObject({
      status: "queued",
      slot_id: "slot_1",
      template_slug: "hero",
      remote: true,
      outcome: "sent",
    })
  })

  it("render route in cloud mode still refuses a posted slot", async () => {
    mode.mockReturnValue("cloud")
    const stories = {
      listStorySlots: jest.fn(async () => [
        { ...slot, posted_at: new Date() },
      ]),
      updateSlotMetadata: jest.fn(),
    }
    const { res, out } = fakeRes()
    await renderPost(
      fakeReq({ [STORIES_KEY]: stories }, { id: "slot_1" }, {
        template_slug: "hero",
      }),
      res,
    )
    expect(out.status).toBe(409)
    expect(dispatchSlot).not.toHaveBeenCalled()
  })

  it("auto-render in cloud mode dispatches the picked template", async () => {
    mode.mockReturnValue("cloud")
    const stories = {
      listStorySlots: jest.fn(async () => [slot]),
      updateSlotMetadata: jest.fn(),
    }
    const { res, out } = fakeRes()
    await autoRenderPost(fakeReq({ [STORIES_KEY]: stories }, { id: "slot_1" }), res)
    expect(dispatchSlot).toHaveBeenCalledWith(
      deps,
      slot,
      {
        template_slug: "picked",
        slot_inputs: { a: "x" },
        text_overrides: {},
        plan_id: "plan_1",
        slot_index: 2,
      },
      { kind: "prod", manual: true },
    )
    expect(out.status).toBe(202)
    expect(out.body).toMatchObject({
      template_slug: "picked",
      remote: true,
      outcome: "sent",
    })
  })

  it("batch-render in cloud mode awaits dispatchPlan with force and manual", async () => {
    mode.mockReturnValue("cloud")
    const stories = {
      listStoryPlans: jest.fn(async () => [{ id: "plan_1" }]),
      listStorySlots: jest.fn(async () => [slot]),
    }
    const { res, out } = fakeRes()
    await batchRenderPost(
      fakeReq({ [STORIES_KEY]: stories }, { id: "plan_1" }, { force: true }),
      res,
    )
    expect(dispatchPlan).toHaveBeenCalledWith(deps, "plan_1", {
      kind: "prod",
      force: true,
      manual: true,
    })
    expect(out.status).toBe(202)
    expect(out.body.remote).toBe(true)
    expect(out.body.queued).toBe(1)
  })

  it("render-sample in cloud mode answers 409", async () => {
    mode.mockReturnValue("cloud")
    const { res, out } = fakeRes()
    await renderSamplePost(fakeReq({}, { slug: "hero" }), res)
    expect(out.status).toBe(409)
    expect(out.body).toEqual({
      message: "Sample renders are off while stories render in the cloud.",
    })
  })

  it("shadow-render outside shadow mode answers 409", async () => {
    mode.mockReturnValue("local")
    const { res, out } = fakeRes()
    await shadowRenderPost(fakeReq({}, { id: "plan_1" }), res)
    expect(out.status).toBe(409)
    expect(out.body).toEqual({
      message: "Shadow renders run only when STORIES_RENDER_MODE=shadow.",
    })
    expect(dispatchPlan).not.toHaveBeenCalled()
  })

  it("shadow-render in shadow mode dispatches a forced shadow plan", async () => {
    mode.mockReturnValue("shadow")
    ;(dispatchPlan as jest.Mock).mockResolvedValue([{ status: "sent" }])
    ;(summarizeDispatch as jest.Mock).mockReturnValue({
      sent: 3,
      skipped: 1,
      failed: 0,
    })
    const { res, out } = fakeRes()
    await shadowRenderPost(fakeReq({}, { id: "plan_1" }), res)
    expect(dispatchPlan).toHaveBeenCalledWith(deps, "plan_1", {
      kind: "shadow",
      force: true,
    })
    expect(out.status).toBe(200)
    expect(out.body).toEqual({
      plan_id: "plan_1",
      sent: 3,
      skipped: 1,
      failed: 0,
    })
  })
})

describe("create-tomorrow-plan", () => {
  const OLD_ENV = process.env
  const sent = () =>
    (sendTelegram as jest.Mock).mock.calls.map((c) => c[0] as string).join("\n")

  function container() {
    const stories = {
      listStoryPlans: jest.fn(async () => []),
      getSettings: jest.fn(async () => ({
        default_distribution: [{ count: 2 }],
        default_schedule: ["10:00", "12:00"],
      })),
      createPlan: jest.fn(async () => ({ id: "plan_1" })),
      regeneratePlan: jest.fn(async () => undefined),
      listStorySlots: jest.fn(async () => [
        { id: "s1", product_id: "p1" },
        { id: "s2", product_id: null },
      ]),
    }
    return {
      resolve: (key: string) =>
        key === STORIES_KEY
          ? stories
          : { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    } as any
  }

  beforeEach(() => {
    process.env = { ...OLD_ENV, STORIES_RENDER_REMOTE_ONLY: "true" }
    delete process.env.STORIES_FILLER_WEEKDAY
  })
  afterEach(() => {
    process.env = OLD_ENV
  })

  it("in cloud mode dispatches and reports", async () => {
    mode.mockReturnValue("cloud")
    ;(dispatchPlan as jest.Mock).mockResolvedValue([{ status: "sent" }])
    ;(summarizeDispatch as jest.Mock).mockReturnValue({
      sent: 7,
      skipped: 0,
      failed: 0,
    })
    await createTomorrowPlan(container())
    expect(dispatchPlan).toHaveBeenCalledWith(deps, "plan_1", { kind: "prod" })
    expect(sent()).toContain("☁️ Rendering in the cloud: 7 sent")
    expect(sent()).not.toContain("Not sent yet")
  })

  it("in cloud mode reports failed sends as retrying", async () => {
    mode.mockReturnValue("cloud")
    ;(summarizeDispatch as jest.Mock).mockReturnValue({
      sent: 5,
      skipped: 0,
      failed: 2,
    })
    await createTomorrowPlan(container())
    expect(sent()).toContain("⚠️ Not sent yet, retrying: 2")
  })

  it("in cloud mode with missing config alerts and returns", async () => {
    mode.mockReturnValue("cloud")
    ;(createCloudDeps as jest.Mock).mockImplementation(() => {
      throw new Error("STORY_RENDER_API_KEY is not set")
    })
    await createTomorrowPlan(container())
    expect(sent()).toContain(
      "⚠️ Cloud render is not configured: STORY_RENDER_API_KEY is not set",
    )
    expect(dispatchPlan).not.toHaveBeenCalled()
  })

  it("in shadow mode survives a shadow failure", async () => {
    mode.mockReturnValue("shadow")
    ;(dispatchPlan as jest.Mock).mockRejectedValue(new Error("boom"))
    await expect(createTomorrowPlan(container())).resolves.toBeUndefined()
    expect(sent()).toContain("Rendering will run on the local CLI")
    expect(sent()).not.toContain("🧪 Shadow")
  })

  it("in shadow mode survives missing cloud config", async () => {
    mode.mockReturnValue("shadow")
    ;(createCloudDeps as jest.Mock).mockImplementation(() => {
      throw new Error("STORY_RENDER_API_KEY is not set")
    })
    await expect(createTomorrowPlan(container())).resolves.toBeUndefined()
    expect(sent()).toContain("Rendering will run on the local CLI")
  })

  it("in shadow mode adds the shadow line", async () => {
    mode.mockReturnValue("shadow")
    ;(summarizeDispatch as jest.Mock).mockReturnValue({
      sent: 4,
      skipped: 0,
      failed: 0,
    })
    await createTomorrowPlan(container())
    expect(dispatchPlan).toHaveBeenCalledWith(deps, "plan_1", { kind: "shadow" })
    expect(sent()).toContain("🧪 Shadow: 4 sent to the cloud")
    expect(sent()).toContain("Rendering will run on the local CLI")
  })

  it("local mode is unchanged", async () => {
    mode.mockReturnValue("local")
    await createTomorrowPlan(container())
    expect(dispatchPlan).not.toHaveBeenCalled()
    expect(dispatchSlot).not.toHaveBeenCalled()
    expect(createCloudDeps).not.toHaveBeenCalled()
    expect(sent()).toContain("Rendering will run on the local CLI")
  })
})

describe("local mode at the routes", () => {
  it("never dispatches", async () => {
    mode.mockReturnValue("local")
    const stories = {
      listStorySlots: jest.fn(async () => [slot]),
      listStoryPlans: jest.fn(async () => [{ id: "plan_1" }]),
      updateSlotMetadata: jest.fn(),
    }
    process.env.STORIES_RENDER_REMOTE_ONLY = "true"
    const { res } = fakeRes()
    await renderPost(
      fakeReq({ [STORIES_KEY]: stories }, { id: "slot_1" }, {
        template_slug: "hero",
      }),
      res,
    )
    const b = fakeRes()
    await batchRenderPost(
      fakeReq({ [STORIES_KEY]: stories }, { id: "plan_1" }),
      b.res,
    )
    expect(dispatchSlot).not.toHaveBeenCalled()
    expect(dispatchPlan).not.toHaveBeenCalled()
    delete process.env.STORIES_RENDER_REMOTE_ONLY
  })
})
