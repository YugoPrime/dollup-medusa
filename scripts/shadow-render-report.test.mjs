import { test } from "node:test"
import assert from "node:assert/strict"
import { compareShadow } from "./shadow-render-report.mjs"

const H = (n) => String(n).padStart(16, "a")
const laptop = (id, h) => ({
  mp4_url: `https://cdn.dollupboutique.com/stories/${id}/${h}.mp4`,
  template_slug: "t",
  duration_ms: 1000,
})
const shadow = (id, h, extra = {}) => ({
  job_id: `${id}_${h}`,
  state: "done",
  sent_at: "2026-11-06T10:00:00Z",
  resolved_at: "2026-11-06T10:02:00Z",
  mp4_url: `https://cdn.dollupboutique.com/stories-shadow/${id}/${h}.mp4`,
  duration_ms: 120000,
  ...extra,
})
const slot = (i, lh, sh, extra) => ({
  id: `slot_${i}`,
  slot_index: i,
  metadata: {
    ...(lh ? { render: laptop(`slot_${i}`, lh) } : {}),
    ...(sh ? { render_shadow: shadow(`slot_${i}`, sh, extra) } : {}),
  },
})
const seven = () => [0, 1, 2, 3, 4, 5, 6].map((i) => slot(i, H(i), H(i)))

test("PASS: all slots same", () => {
  const r = compareShadow(seven())
  assert.equal(r.verdict, "PASS")
  assert.equal(r.rows.length, 7)
  assert.ok(r.rows.every((x) => x.result === "same"))
  assert.equal(r.rows[2].laptop, H(2))
  assert.equal(r.rows[2].shadow, H(2))
})

test("CHECK: one inputs differ", () => {
  const s = seven()
  s[3] = slot(3, H(3), H(99))
  const r = compareShadow(s)
  assert.equal(r.verdict, "CHECK")
  assert.equal(r.rows[3].result, "inputs differ")
})

test("FAIL: failed shadow", () => {
  const s = seven()
  s[1] = slot(1, H(1), null, { state: "failed", mp4_url: undefined, stage: "render", message: "x" })
  s[1].metadata.render_shadow = { job_id: "j", state: "failed", sent_at: "t", stage: "render", message: "x" }
  const r = compareShadow(s)
  assert.equal(r.verdict, "FAIL")
  assert.equal(r.rows[1].result, "failed")
})

test("FAIL: missing shadow, and sent-without-result counts as missing", () => {
  const s = seven()
  s[0] = slot(0, H(0), null)
  s[5].metadata.render_shadow = { job_id: "j", state: "sent", sent_at: "t" }
  const r = compareShadow(s)
  assert.equal(r.verdict, "FAIL")
  assert.equal(r.rows[0].result, "missing")
  assert.equal(r.rows[5].result, "missing")
})

test("FAIL: slow shadow (250000 ms)", () => {
  const s = seven()
  s[4] = slot(4, H(4), H(4), { duration_ms: 250000 })
  const r = compareShadow(s)
  assert.equal(r.verdict, "FAIL")
  assert.equal(r.rows[4].result, "slow")
})

test("no laptop render alone stays PASS", () => {
  const s = seven()
  s[2] = slot(2, null, H(2))
  const r = compareShadow(s)
  assert.equal(r.verdict, "PASS")
  assert.equal(r.rows[2].result, "no laptop render")
})

test("null metadata is missing; rows ordered by slot_index", () => {
  const r = compareShadow([{ id: "b", slot_index: 1, metadata: null }, slot(0, H(0), H(0))])
  assert.deepEqual(r.rows.map((x) => x.index), [0, 1])
  assert.equal(r.rows[1].result, "missing")
  assert.equal(r.verdict, "FAIL")
})
