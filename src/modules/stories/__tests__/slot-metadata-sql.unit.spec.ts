import { dropRenderKeysSql, mergeSlotMetadataSql } from "../slot-metadata-sql"

describe("mergeSlotMetadataSql", () => {
  it("sends the patch as one JSON parameter", () => {
    const { sql, params } = mergeSlotMetadataSql("stslot_1", { render_error: null, a: { b: 1 } })
    expect(params).toEqual(['{"render_error":null,"a":{"b":1}}', "stslot_1"])
    expect(sql).toMatch(/COALESCE\(metadata, '\{\}'::jsonb\) \|\| \?::jsonb/)
    expect(sql).not.toMatch(/posted_at/)
  })

  it("the job guard adds the unposted and job id conditions", () => {
    const { sql, params } = mergeSlotMetadataSql("stslot_1", {}, { jobId: "stslot_1_0123456789abcdef" })
    expect(params).toEqual(["{}", "stslot_1", "stslot_1_0123456789abcdef"])
    expect(sql).toMatch(/posted_at IS NULL/)
    expect(sql).toMatch(/metadata -> 'render_job' ->> 'job_id' = \?/)
  })
})

describe("mergeSlotMetadataSql state guard", () => {
  it("state.is adds an equality clause after the job id", () => {
    const { sql, params } = mergeSlotMetadataSql("s1", {}, { jobId: "J", state: { is: "sent" } })
    expect(sql).toContain("AND metadata -> 'render_job' ->> 'state' = ?")
    expect(params).toEqual(["{}", "s1", "J", "sent"])
  })

  it("state.isNot adds an IS DISTINCT FROM clause after the job id", () => {
    const { sql, params } = mergeSlotMetadataSql("s1", {}, { jobId: "J", state: { isNot: "done" } })
    expect(sql).toContain("AND (metadata -> 'render_job' ->> 'state') IS DISTINCT FROM ?")
    expect(params).toEqual(["{}", "s1", "J", "done"])
  })

  it("both clauses keep clause order in params", () => {
    const { params } = mergeSlotMetadataSql("s1", {}, { jobId: "J", state: { is: "sent", isNot: "done" } })
    expect(params).toEqual(["{}", "s1", "J", "sent", "done"])
  })
})

describe("dropRenderKeysSql", () => {
  it("removes every render key from a live slot", () => {
    const { sql, params } = dropRenderKeysSql("stslot_1")
    expect(params).toEqual(["stslot_1"])
    expect(sql).toContain(
      "- ARRAY['render','render_error','render_started_at','render_job','render_shadow']::text[]",
    )
    expect(sql).toContain("deleted_at IS NULL")
  })
})
