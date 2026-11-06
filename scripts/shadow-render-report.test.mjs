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
  output_key: `stories-shadow/${id}/${h}.mp4`,
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

test("null metadata is not rendered; rows ordered by slot_index", () => {
  const r = compareShadow([{ id: "b", slot_index: 1, metadata: null }, slot(0, H(0), H(0))])
  assert.deepEqual(r.rows.map((x) => x.index), [0, 1])
  assert.equal(r.rows[1].result, "not rendered")
  assert.equal(r.verdict, "PASS")
})

test("neither side rendered is neutral: not rendered, verdict PASS", () => {
  const s = seven()
  s[6] = slot(6, null, null)
  const r = compareShadow(s)
  assert.equal(r.rows[6].result, "not rendered")
  assert.equal(r.rows[6].laptop, "-")
  assert.equal(r.rows[6].shadow, "-")
  assert.equal(r.verdict, "PASS")
})

test("not rendered does not hide an inputs-differ CHECK", () => {
  const s = seven()
  s[6] = slot(6, null, null)
  s[3] = slot(3, H(3), H(99))
  assert.equal(compareShadow(s).verdict, "CHECK")
})

test("done shadow whose URL path is not its output_key counts as failed", () => {
  const s = seven()
  s[3].metadata.render_shadow.mp4_url = `https://cdn.dollupboutique.com/stories/slot_3/${H(3)}.mp4`
  const r = compareShadow(s)
  assert.equal(r.rows[3].result, "failed")
  assert.equal(r.verdict, "FAIL")
})

test("done shadow with an unparseable URL counts as failed", () => {
  const s = seven()
  s[4].metadata.render_shadow.mp4_url = `not a url/${H(4)}.mp4`
  const r = compareShadow(s)
  assert.equal(r.rows[4].result, "failed")
  assert.equal(r.verdict, "FAIL")
})

test("done shadow without an output_key counts as failed", () => {
  const s = seven()
  delete s[5].metadata.render_shadow.output_key
  const r = compareShadow(s)
  assert.equal(r.rows[5].result, "failed")
  assert.equal(r.verdict, "FAIL")
})

test("empty plan is FAIL, not a vacuous PASS", () => {
  const r = compareShadow([])
  assert.equal(r.verdict, "FAIL")
  assert.equal(r.rows.length, 0)
})

test("done shadow without mp4_url counts as failed", () => {
  const s = seven()
  s[2].metadata.render_shadow = { job_id: "j", state: "done", sent_at: "t", duration_ms: 1000 }
  const r = compareShadow(s)
  assert.equal(r.rows[2].result, "failed")
  assert.equal(r.verdict, "FAIL")
})
