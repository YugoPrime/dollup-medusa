import { describe, expect, it } from "@jest/globals"

import { createRenderClient } from "../cloud/client"
import type { CloudJobRequest } from "../cloud/job"

const cfg = {
  baseUrl: "https://render.example.workers.dev",
  apiKey: "k",
  callbackSecret: "s",
  callbackUrl: "https://api.example.com/hooks/story-render",
}
const job: CloudJobRequest = {
  job_id: "stslot_01JX_0123456789abcdef",
  template: "dollup/in-stock-hero",
  images: { hero: "https://cdn.example.com/x.jpg" },
  text: { price: "Rs.790" },
  brand: null,
  audio: { pool: "dollup", seed: "stplan_01JY", index: 2 },
  output_key: "stories/stslot_01JX/0123456789abcdef.mp4",
  callback_url: cfg.callbackUrl,
}

type Call = { url: string; init: RequestInit }
function fake(status: number, body: unknown) {
  const calls: Call[] = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { calls, impl }
}

describe("render client submit", () => {
  it("sends auth, json and the job as body", async () => {
    const f = fake(202, { job_id: job.job_id, status: "queued" })
    const res = await createRenderClient(cfg, f.impl).submit(job)
    expect(res).toEqual({ kind: "accepted", status: "queued" })
    expect(f.calls[0].url).toBe(`${cfg.baseUrl}/v1/jobs`)
    expect(f.calls[0].init.method).toBe("POST")
    const headers = new Headers(f.calls[0].init.headers)
    expect(headers.get("authorization")).toBe("Bearer k")
    expect(headers.get("content-type")).toBe("application/json")
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual(job)
  })

  it("202 done is accepted/done", async () => {
    const f = fake(202, { job_id: job.job_id, status: "done" })
    expect(await createRenderClient(cfg, f.impl).submit(job)).toEqual({
      kind: "accepted",
      status: "done",
    })
  })

  it("409 is rejected with the body's error", async () => {
    const f = fake(409, { error: "job_id_conflict" })
    expect(await createRenderClient(cfg, f.impl).submit(job)).toEqual({
      kind: "rejected",
      httpStatus: 409,
      error: "job_id_conflict",
    })
  })

  it("400, 401 and 403 are rejected", async () => {
    for (const status of [400, 401, 403]) {
      const f = fake(status, { error: "nope" })
      const res = await createRenderClient(cfg, f.impl).submit(job)
      expect(res).toMatchObject({ kind: "rejected", httpStatus: status })
    }
  })

  it("503 is unavailable", async () => {
    const f = fake(503, { error: "busy" })
    expect((await createRenderClient(cfg, f.impl).submit(job)).kind).toBe(
      "unavailable"
    )
  })

  it("a throwing fetch is unavailable and the reason hides the key", async () => {
    const impl = (async () => {
      throw new Error("boom")
    }) as unknown as typeof fetch
    const res = await createRenderClient(cfg, impl).submit(job)
    expect(res.kind).toBe("unavailable")
    expect(JSON.stringify(res)).not.toContain("Bearer")
  })

  it("a fetch that never resolves is unavailable within the timeout", async () => {
    const impl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(new Error("aborted"))
        )
      })) as unknown as typeof fetch
    const started = Date.now()
    const res = await createRenderClient(cfg, impl, { timeoutMs: 50 }).submit(
      job
    )
    expect(res.kind).toBe("unavailable")
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

describe("render client get", () => {
  it("404 is not_found", async () => {
    const f = fake(404, { error: "not_found" })
    expect(await createRenderClient(cfg, f.impl).get("x")).toBe("not_found")
  })

  it("200 returns the remote job", async () => {
    const remote = {
      job_id: "x",
      status: "done",
      attempts: 1,
      mp4_url: "https://cdn.example.com/x.mp4",
      error: null,
      callback_state: "delivered",
      updated_at: "2026-11-06T10:00:00Z",
    }
    const f = fake(200, remote)
    const res = await createRenderClient(cfg, f.impl).get("x")
    expect(res).toEqual(remote)
    expect(f.calls[0].url).toBe(`${cfg.baseUrl}/v1/jobs/x`)
    expect(new Headers(f.calls[0].init.headers).get("authorization")).toBe(
      "Bearer k"
    )
  })

  it("5xx and network errors are unavailable", async () => {
    expect(await createRenderClient(cfg, fake(500, {}).impl).get("x")).toBe(
      "unavailable"
    )
    const impl = (async () => {
      throw new Error("down")
    }) as unknown as typeof fetch
    expect(await createRenderClient(cfg, impl).get("x")).toBe("unavailable")
  })
})
