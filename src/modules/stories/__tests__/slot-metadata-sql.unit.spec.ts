import { mergeSlotMetadataSql } from "../slot-metadata-sql"

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
