import { createHmac } from "crypto"
import {
  applyCallback,
  decideCallbackWrite,
  handleRenderCallback,
  parseCallbackBody,
  remoteJobToCallback,
  type CallbackBody,
  type CallbackStories,
} from "../cloud/callback"
import type { CloudSlot } from "../cloud/job"
import type { RemoteJob } from "../cloud/client"

const NOW = new Date("2026-11-06T10:00:00.000Z")
const HASH = "0123456789abcdef"
const OTHER_HASH = "fedcba9876543210"
const SLOT_ID = "stslot_ABC123"
const PROD_ID = `${SLOT_ID}_${HASH}`
const SHADOW_ID = `shadow_${SLOT_ID}_${HASH}`
const OUTPUT_KEY = `stories/${SLOT_ID}/${HASH}.mp4`
const MP4_URL = `https://cdn.example.com/${OUTPUT_KEY}`

function prodJob(over: Record<string, unknown> = {}) {
  return {
    job_id: PROD_ID,
    output_key: OUTPUT_KEY,
    template_slug: "tpl-a",
    slot_inputs: { img: "https://x/y.jpg" },
    text_overrides: { title: "Hi" },
    state: "sent",
    dispatch_count: 1,
    sent_at: "2026-11-06T09:50:00.000Z",
    ...over,
  }
}

function slot(metadata: unknown, posted: Date | null = null): CloudSlot {
  return {
    id: SLOT_ID,
    plan_id: "stplan_1",
    slot_index: 0,
    scheduled_at: NOW,
    posted_at: posted,
    metadata,
  }
}

function ok(over: Record<string, unknown> = {}): CallbackBody {
  return {
    job_id: PROD_ID,
    status: "ok",
    mp4_url: MP4_URL,
    duration_ms: 12000,
    width: 1080,
    height: 1920,
    fps: 30,
    template: "dollup/tpl-a",
    ...over,
  } as CallbackBody
}

function err(over: Record<string, unknown> = {}): CallbackBody {
  return {
    job_id: PROD_ID,
    status: "error",
    stage: "render",
    message: "boom",
    stderr_tail: "tail",
    ...over,
  } as CallbackBody
}

const sentMeta = () => ({ render_job: prodJob() })

describe("decideCallbackWrite", () => {
  it("ignores an unparseable job id", () => {
    expect(decideCallbackWrite(slot(sentMeta()), ok({ job_id: "nope" }), NOW)).toEqual({
      action: "ignore",
      reason: "unknown job id",
    })
  })

  it("ignores a missing slot", () => {
    expect(decideCallbackWrite(null, ok(), NOW)).toEqual({
      action: "ignore",
      reason: "slot not found",
    })
  })

  it("ignores a stale shadow job", () => {
    const s = slot({
      render_shadow: {
        job_id: `shadow_${SLOT_ID}_${OTHER_HASH}`,
        output_key: "k",
        state: "sent",
        sent_at: "t",
      },
    })
    expect(decideCallbackWrite(s, ok({ job_id: SHADOW_ID }), NOW)).toEqual({
      action: "ignore",
      reason: "stale shadow job",
    })
    expect(decideCallbackWrite(slot({}), ok({ job_id: SHADOW_ID }), NOW)).toEqual({
      action: "ignore",
      reason: "stale shadow job",
    })
  })

  it("writes a shadow ok into render_shadow only, unguarded", () => {
    const shadow = { job_id: SHADOW_ID, output_key: "stories-shadow/x.mp4", state: "sent", sent_at: "t0" }
    const d = decideCallbackWrite(slot({ render_shadow: shadow }), ok({ job_id: SHADOW_ID }), NOW)
    expect(d).toEqual({
      action: "write",
      kind: "shadow",
      slotId: SLOT_ID,
      guardJobId: null,
      patch: {
        render_shadow: {
          ...shadow,
          state: "done",
          resolved_at: NOW.toISOString(),
          mp4_url: MP4_URL,
          duration_ms: 12000,
        },
      },
    })
    if (d.action === "write") expect(Object.keys(d.patch)).toEqual(["render_shadow"])
  })

  it("writes a shadow error with stage and message", () => {
    const shadow = { job_id: SHADOW_ID, output_key: "k", state: "sent", sent_at: "t0" }
    const d = decideCallbackWrite(slot({ render_shadow: shadow }), err({ job_id: SHADOW_ID }), NOW)
    expect(d).toEqual({
      action: "write",
      kind: "shadow",
      slotId: SLOT_ID,
      guardJobId: null,
      patch: {
        render_shadow: {
          ...shadow,
          state: "failed",
          resolved_at: NOW.toISOString(),
          stage: "render",
          message: "boom",
        },
      },
    })
  })

  it("never touches a posted slot", () => {
    expect(decideCallbackWrite(slot(sentMeta(), new Date()), ok(), NOW)).toEqual({
      action: "ignore",
      reason: "slot already posted",
    })
    expect(decideCallbackWrite(slot(sentMeta(), new Date()), err(), NOW)).toEqual({
      action: "ignore",
      reason: "slot already posted",
    })
  })

  it("a callback for a swapped slot is ignored", () => {
    const meta = { render_job: prodJob({ job_id: `${SLOT_ID}_${OTHER_HASH}` }) }
    expect(decideCallbackWrite(slot(meta), ok(), NOW)).toEqual({ action: "ignore", reason: "stale job" })
    expect(decideCallbackWrite(slot(meta), err(), NOW)).toEqual({ action: "ignore", reason: "stale job" })
    expect(decideCallbackWrite(slot({}), ok(), NOW)).toEqual({ action: "ignore", reason: "stale job" })
  })

  it("an mp4_url outside the output_key is ignored", () => {
    const bad = ok({ mp4_url: `https://cdn.example.com/stories/${SLOT_ID}/other.mp4` })
    expect(decideCallbackWrite(slot(sentMeta()), bad, NOW)).toEqual({
      action: "ignore",
      reason: "mp4_url does not match output_key",
    })
    expect(decideCallbackWrite(slot(sentMeta()), ok({ mp4_url: "not a url" }), NOW)).toEqual({
      action: "ignore",
      reason: "mp4_url does not match output_key",
    })
  })

  it("ignores an ok on a done job (duplicate)", () => {
    const meta = { render_job: prodJob({ state: "done" }) }
    expect(decideCallbackWrite(slot(meta), ok(), NOW)).toEqual({ action: "ignore", reason: "duplicate" })
  })

  it("writes a prod ok in today's exact shapes", () => {
    const d = decideCallbackWrite(slot(sentMeta()), ok(), NOW)
    expect(d).toEqual({
      action: "write",
      kind: "prod",
      slotId: SLOT_ID,
      guardJobId: PROD_ID,
      guardState: { isNot: "done" },
      patch: {
        render: {
          mp4_url: MP4_URL,
          template_slug: "tpl-a",
          slot_inputs: { img: "https://x/y.jpg" },
          text_overrides: { title: "Hi" },
          generated_at: NOW.toISOString(),
          duration_ms: 12000,
          width: 1080,
          height: 1920,
          fps: 30,
        },
        render_started_at: null,
        render_error: null,
        render_job: { ...prodJob(), state: "done", resolved_at: NOW.toISOString() },
      },
    })
  })

  it("ignores an error when the job is not in state sent", () => {
    for (const state of ["done", "failed"]) {
      const meta = { render_job: prodJob({ state }) }
      expect(decideCallbackWrite(slot(meta), err(), NOW)).toEqual({
        action: "ignore",
        reason: "duplicate or superseded",
      })
    }
  })

  it("writes a prod error in today's exact shapes", () => {
    const d = decideCallbackWrite(slot(sentMeta()), err(), NOW)
    expect(d).toEqual({
      action: "write",
      kind: "prod",
      slotId: SLOT_ID,
      guardJobId: PROD_ID,
      guardState: { is: "sent" },
      patch: {
        render_error: {
          message: "boom",
          name: "CloudRenderError",
          stage: "render",
          stderr_tail: "tail",
          failed_at: NOW.toISOString(),
        },
        render_started_at: null,
        render_job: { ...prodJob(), state: "failed", resolved_at: NOW.toISOString() },
      },
    })
  })

  it("defaults a missing stderr_tail to null", () => {
    const d = decideCallbackWrite(slot(sentMeta()), err({ stderr_tail: undefined }), NOW)
    if (d.action !== "write") throw new Error("expected write")
    expect((d.patch.render_error as { stderr_tail: unknown }).stderr_tail).toBeNull()
  })

  it("a stale error during a re-run, then the ok, ends rendered", () => {
    let meta: Record<string, unknown> = { render_job: prodJob() }
    const first = decideCallbackWrite(slot(meta), err(), NOW)
    if (first.action !== "write") throw new Error("expected write")
    meta = { ...meta, ...first.patch }
    expect((meta.render_job as { state: string }).state).toBe("failed")

    const second = decideCallbackWrite(slot(meta), ok(), NOW)
    if (second.action !== "write") throw new Error("expected write")
    expect(second.patch.render_error).toBeNull()
    expect((second.patch.render_job as { state: string }).state).toBe("done")
    expect(second.patch.render).toBeDefined()
  })

  it("a second ok is ignored", () => {
    const first = decideCallbackWrite(slot(sentMeta()), ok(), NOW)
    if (first.action !== "write") throw new Error("expected write")
    const meta = { ...sentMeta(), ...first.patch }
    expect(decideCallbackWrite(slot(meta), ok(), NOW)).toEqual({ action: "ignore", reason: "duplicate" })
  })
})

describe("parseCallbackBody", () => {
  it("accepts ok and error shapes", () => {
    expect(parseCallbackBody(ok())).toEqual(ok())
    expect(parseCallbackBody(err())).toEqual(err())
    expect(
      parseCallbackBody({ job_id: "a", status: "error", stage: "s", message: "m", stderr_tail: null })
    ).toEqual({ job_id: "a", status: "error", stage: "s", message: "m", stderr_tail: null })
  })

  it("rejects bad shapes", () => {
    expect(parseCallbackBody(null)).toBeNull()
    expect(parseCallbackBody([])).toBeNull()
    expect(parseCallbackBody({})).toBeNull()
    expect(parseCallbackBody({ status: "ok" })).toBeNull()
    expect(parseCallbackBody({ job_id: "a", status: "weird" })).toBeNull()
    expect(parseCallbackBody({ ...ok(), mp4_url: 5 })).toBeNull()
    expect(parseCallbackBody({ ...ok(), duration_ms: "1" })).toBeNull()
    expect(parseCallbackBody({ job_id: "a", status: "error", stage: "s" })).toBeNull()
  })
})

describe("remoteJobToCallback", () => {
  const base: RemoteJob = {
    job_id: PROD_ID,
    status: "done",
    attempts: 1,
    mp4_url: MP4_URL,
    error: null,
    callback_state: "pending",
    updated_at: "t",
  }

  it("maps done to ok with fixed dimensions", () => {
    expect(remoteJobToCallback(base, "dollup/tpl-a")).toEqual({
      job_id: PROD_ID,
      status: "ok",
      mp4_url: MP4_URL,
      duration_ms: 0,
      width: 1080,
      height: 1920,
      fps: 30,
      template: "dollup/tpl-a",
    })
  })

  it("returns null for done without an mp4_url", () => {
    expect(remoteJobToCallback({ ...base, mp4_url: null }, "t")).toBeNull()
  })

  it("maps failed to error, with defaults", () => {
    expect(
      remoteJobToCallback(
        { ...base, status: "failed", mp4_url: null, error: { stage: "tts", message: "x", stderr_tail: "e" } },
        "t"
      )
    ).toEqual({ job_id: PROD_ID, status: "error", stage: "tts", message: "x", stderr_tail: "e" })
    expect(remoteJobToCallback({ ...base, status: "failed", mp4_url: null }, "t")).toEqual({
      job_id: PROD_ID,
      status: "error",
      stage: "unknown",
      message: "render failed",
      stderr_tail: null,
    })
  })

  it("returns null while rendering or for an unknown status", () => {
    expect(remoteJobToCallback({ ...base, status: "rendering" }, "t")).toBeNull()
    expect(remoteJobToCallback({ ...base, status: "queued" }, "t")).toBeNull()
    expect(remoteJobToCallback({ ...base, status: "bogus" as never }, "t")).toBeNull()
  })
})

describe("applyCallback", () => {
  function fakeStories(s: CloudSlot | null, guarded = true) {
    const calls = { guarded: [] as unknown[][], plain: [] as unknown[][] }
    const stories = {
      listStorySlots: jest.fn(async () => (s ? [s] : [])),
      updateSlotMetadata: jest.fn(async (...a: unknown[]) => {
        calls.plain.push(a)
      }),
      updateSlotMetadataIfJob: jest.fn(async (...a: unknown[]) => {
        calls.guarded.push(a)
        return guarded
      }),
    }
    return { stories: stories as unknown as CallbackStories, mocks: stories, calls }
  }

  it("prod writes use updateSlotMetadataIfJob with the job id", async () => {
    const { stories, mocks, calls } = fakeStories(slot(sentMeta()))
    expect(await applyCallback(stories, ok(), NOW)).toEqual({ action: "written" })
    expect(calls.guarded).toHaveLength(1)
    expect(calls.guarded[0][0]).toBe(SLOT_ID)
    expect(calls.guarded[0][1]).toBe(PROD_ID)
    expect(calls.guarded[0][3]).toEqual({ isNot: "done" })
    expect(mocks.listStorySlots).toHaveBeenCalledWith({ id: SLOT_ID })
    expect(calls.plain).toHaveLength(0)
  })

  it("an error write passes the sent-state guard", async () => {
    const { stories, calls } = fakeStories(slot(sentMeta()))
    await applyCallback(stories, err(), NOW)
    expect(calls.guarded[0][3]).toEqual({ is: "sent" })
  })

  it("a false guard result is ignored", async () => {
    const { stories } = fakeStories(slot(sentMeta()), false)
    expect(await applyCallback(stories, ok(), NOW)).toEqual({
      action: "ignored",
      reason: "slot changed while writing",
    })
  })

  it("shadow writes use updateSlotMetadata", async () => {
    const shadow = { job_id: SHADOW_ID, output_key: "k", state: "sent", sent_at: "t0" }
    const { stories, calls } = fakeStories(slot({ render_shadow: shadow }))
    expect(await applyCallback(stories, ok({ job_id: SHADOW_ID }), NOW)).toEqual({ action: "written" })
    expect(calls.plain).toHaveLength(1)
    expect(calls.plain[0][0]).toBe(SLOT_ID)
    expect(calls.guarded).toHaveLength(0)
  })

  it("ignores without reading when the job id does not parse", async () => {
    const { stories, mocks } = fakeStories(slot(sentMeta()))
    expect(await applyCallback(stories, ok({ job_id: "bad" }), NOW)).toEqual({
      action: "ignored",
      reason: "unknown job id",
    })
    expect(mocks.listStorySlots).not.toHaveBeenCalled()
  })

  it("ignores a missing slot", async () => {
    const { stories } = fakeStories(null)
    expect(await applyCallback(stories, ok(), NOW)).toEqual({
      action: "ignored",
      reason: "slot not found",
    })
  })
})

describe("handleRenderCallback", () => {
  const SECRET = "s3cret"
  const NOW_SEC = 1_800_000_000
  const sign = (body: Buffer) =>
    `t=${NOW_SEC},v1=${createHmac("sha256", SECRET).update(`${NOW_SEC}.`).update(body).digest("hex")}`
  const mk = (apply: jest.Mock) => ({ apply, secret: SECRET, nowSec: NOW_SEC })
  let logSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {})
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    jest.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  /** The single rejection line, parsed, plus its raw text for leak checks. */
  function rejectionLine(): { parsed: unknown; raw: string } {
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]).toHaveLength(1)
    const raw = warnSpy.mock.calls[0][0] as string
    expect(logSpy).not.toHaveBeenCalled()
    return { parsed: JSON.parse(raw), raw }
  }

  it("401 on a bad signature, without applying, logging one line without the header", async () => {
    const apply = jest.fn()
    const body = Buffer.from(JSON.stringify(ok()))
    // A well-formed header signed with the wrong secret.
    const header = `t=${NOW_SEC},v1=${createHmac("sha256", "wrong-secret").update(`${NOW_SEC}.`).update(body).digest("hex")}`
    const r = await handleRenderCallback(mk(apply), body, header)
    expect(r).toEqual({ status: 401, body: { error: "bad signature" } })
    expect(apply).not.toHaveBeenCalled()
    const { parsed, raw } = rejectionLine()
    expect(parsed).toEqual({
      msg: "[stories-render:callback]",
      action: "rejected",
      reason: "bad signature",
    })
    expect(raw).not.toContain(header.split("v1=")[1])
    expect(raw).not.toContain(SECRET)
    expect(raw).not.toContain(PROD_ID)
  })

  it("400 on non-JSON, logging one line without the body", async () => {
    const body = Buffer.from("not json")
    const header = sign(body)
    const r = await handleRenderCallback(mk(jest.fn()), body, header)
    expect(r.status).toBe(400)
    const { parsed, raw } = rejectionLine()
    expect(parsed).toEqual({
      msg: "[stories-render:callback]",
      action: "rejected",
      reason: "bad body",
    })
    expect(raw).not.toContain("not json")
    expect(raw).not.toContain(header.split("v1=")[1])
  })

  it("400 on a body without job_id, logging one line without the body", async () => {
    const body = Buffer.from(JSON.stringify({ status: "ok", mp4_url: "https://leak.example/x.mp4" }))
    const header = sign(body)
    const r = await handleRenderCallback(mk(jest.fn()), body, header)
    expect(r.status).toBe(400)
    const { parsed, raw } = rejectionLine()
    expect(parsed).toEqual({
      msg: "[stories-render:callback]",
      action: "rejected",
      reason: "bad body",
    })
    expect(raw).not.toContain("leak.example")
    expect(raw).not.toContain(header.split("v1=")[1])
  })

  it("500 when apply throws, so the service retries", async () => {
    const body = Buffer.from(JSON.stringify(ok()))
    const apply = jest.fn().mockRejectedValue(new Error("db down"))
    const r = await handleRenderCallback(mk(apply), body, sign(body))
    expect(r.status).toBe(500)
  })

  it("200 with the apply result, logging one line without the signature", async () => {
    const body = Buffer.from(JSON.stringify(ok()))
    const apply = jest.fn().mockResolvedValue({ action: "ignored", reason: "duplicate" })
    const header = sign(body)
    const r = await handleRenderCallback(mk(apply), body, header)
    expect(r).toEqual({ status: 200, body: { ok: true, action: "ignored", reason: "duplicate" } })
    expect(apply).toHaveBeenCalledWith(ok())
    expect(logSpy).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(logSpy.mock.calls[0])
    expect(logged).toContain("[stories-render:callback]")
    expect(logged).toContain(PROD_ID)
    expect(logged).not.toContain(SECRET)
    expect(logged).not.toContain(header.split("v1=")[1])
  })
})
