import { countBeforeSend } from "../cloud/job"
import { describe, expect, it } from "@jest/globals"

import {
  buildCloudJob,
  parseCloudJobId,
  readRenderJob,
  readShadowJob,
} from "../cloud/job"
import { r2KeyFor, renderHash } from "../idempotency"

const slot = { id: "stslot_01JX", plan_id: "stplan_01JY", slot_index: 2 }
const req = {
  template_slug: "in-stock-hero",
  slot_inputs: { hero: "https://cdn.dollupboutique.com/p/x.jpg" },
  text_overrides: { price: "Rs.790" },
}
const CB = "https://api.dollupboutique.com/hooks/story-render"

describe("cloud job", () => {
  it("a prod job keeps the Doll Up key schema", () => {
    const job = buildCloudJob(slot, req, "prod", CB)
    const hash = renderHash(req)
    expect(job.job_id).toBe(`stslot_01JX_${hash}`)
    expect(job.output_key).toBe(r2KeyFor("stslot_01JX", hash))
    expect(job).toMatchObject({
      template: "dollup/in-stock-hero",
      images: req.slot_inputs,
      text: req.text_overrides,
      brand: null,
      audio: { pool: "dollup", seed: "stplan_01JY", index: 2 },
      callback_url: CB,
    })
  })

  it("a shadow job never writes under stories/", () => {
    const job = buildCloudJob(slot, req, "shadow", CB)
    expect(job.job_id).toBe(`shadow_stslot_01JX_${renderHash(req)}`)
    expect(job.output_key).toBe(
      `stories-shadow/stslot_01JX/${renderHash(req)}.mp4`
    )
    expect(job.job_id).toMatch(/^[A-Za-z0-9_-]{1,128}$/)
  })

  it("job ids parse back, foreign ids do not", () => {
    expect(
      parseCloudJobId(buildCloudJob(slot, req, "shadow", CB).job_id)
    ).toEqual({ kind: "shadow", slotId: "stslot_01JX", hash: renderHash(req) })
    expect(
      parseCloudJobId(buildCloudJob(slot, req, "prod", CB).job_id)
    ).toEqual({ kind: "prod", slotId: "stslot_01JX", hash: renderHash(req) })
    for (const id of [
      "stslot_01JX",
      "x_stslot_01JX_0123456789abcdef",
      "stslot_01JX_0123456789ABCDEF",
      "smoke_1",
    ]) {
      expect(parseCloudJobId(id)).toBeNull()
    }
  })

  it("reads stored job state defensively", () => {
    const rj = { job_id: "a", state: "sent" }
    expect(readRenderJob({ render_job: rj })).toEqual(rj)
    expect(readRenderJob({})).toBeNull()
    expect(readRenderJob(null)).toBeNull()
    expect(readRenderJob({ render_job: "x" })).toBeNull()
    const sj = { job_id: "b", state: "done" }
    expect(readShadowJob({ render_shadow: sj })).toEqual(sj)
    expect(readShadowJob(undefined)).toBeNull()
    expect(readShadowJob({ render_shadow: [] })).toBeNull()
  })
})

describe("countBeforeSend", () => {
  it("takes back the stamped send, never below 0", () => {
    expect(countBeforeSend(3)).toBe(2)
    expect(countBeforeSend(1)).toBe(0)
    expect(countBeforeSend(0)).toBe(0)
  })

  it("treats a missing or bad stored count as 0", () => {
    expect(countBeforeSend(undefined)).toBe(0)
    expect(countBeforeSend("2")).toBe(0)
    expect(countBeforeSend(Number.NaN)).toBe(0)
  })
})
