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

describe("mergeSlotMetadataSql slot guard", () => {
  const SLOT_CLAUSE =
    "AND product_id IS NOT DISTINCT FROM ? AND pick_attempt IS NOT DISTINCT FROM ?"

  it("adds the product and pick attempt clause, without the job guard", () => {
    const { sql, params } = mergeSlotMetadataSql("s1", { a: 1 }, undefined, {
      productId: "prod_1",
      pickAttempt: 2,
    })
    expect(sql).toBe(
      "UPDATE story_slot\n" +
        "   SET metadata = COALESCE(metadata, '{}'::jsonb) || ?::jsonb, updated_at = now()\n" +
        " WHERE id = ? AND deleted_at IS NULL\n" +
        `   ${SLOT_CLAUSE}\n` +
        "RETURNING id",
    )
    expect(params).toEqual(['{"a":1}', "s1", "prod_1", 2])
    expect(sql).not.toMatch(/posted_at|render_job/)
  })

  it("passes a null product_id and pick_attempt as params", () => {
    const { params } = mergeSlotMetadataSql("s1", {}, undefined, {
      productId: null,
      pickAttempt: null,
    })
    expect(params).toEqual(["{}", "s1", null, null])
  })

  it("comes after the job guard, in clause order", () => {
    const { sql, params } = mergeSlotMetadataSql(
      "s1",
      {},
      { jobId: "J", state: { is: "sent" } },
      { productId: "prod_1", pickAttempt: 3 },
    )
    const job = sql.indexOf("->> 'job_id' = ?")
    const state = sql.indexOf("->> 'state' = ?")
    const slot = sql.indexOf(SLOT_CLAUSE)
    expect(job).toBeGreaterThan(-1)
    expect(state).toBeGreaterThan(job)
    expect(slot).toBeGreaterThan(state)
    expect(params).toEqual(["{}", "s1", "J", "sent", "prod_1", 3])
  })

  it("leaves the job guard alone when absent", () => {
    const { sql } = mergeSlotMetadataSql("s1", {}, { jobId: "J" })
    expect(sql).not.toContain("product_id")
    expect(sql).not.toContain("pick_attempt")
  })
})

describe("mergeSlotMetadataSql no-job guard and claim", () => {
  const CLAIM_CLAUSE = "AND (metadata ->> ?::text) IS DISTINCT FROM ?"

  it("jobId null requires an unposted slot with no render job, no job id param", () => {
    const { sql, params } = mergeSlotMetadataSql("s1", {}, { jobId: null })
    expect(sql).toContain("AND posted_at IS NULL AND (metadata ->> 'render_job') IS NULL")
    expect(sql).not.toContain("job_id")
    expect(params).toEqual(["{}", "s1"])
  })

  it("the claim comes last, with key then value params", () => {
    const { sql, params } = mergeSlotMetadataSql(
      "s1",
      { k: "v" },
      { jobId: null },
      { productId: null, pickAttempt: 1 },
      { key: "k", value: "v" },
    )
    expect(sql).toBe(
      "UPDATE story_slot\n" +
        "   SET metadata = COALESCE(metadata, '{}'::jsonb) || ?::jsonb, updated_at = now()\n" +
        " WHERE id = ? AND deleted_at IS NULL\n" +
        "   AND posted_at IS NULL AND (metadata ->> 'render_job') IS NULL\n" +
        "   AND product_id IS NOT DISTINCT FROM ? AND pick_attempt IS NOT DISTINCT FROM ?\n" +
        `   ${CLAIM_CLAUSE}\n` +
        "RETURNING id",
    )
    expect(params).toEqual(['{"k":"v"}', "s1", null, 1, "k", "v"])
  })

  it("the claim follows a job guard's params", () => {
    const { params } = mergeSlotMetadataSql(
      "s1",
      {},
      { jobId: "J", state: { is: "failed" } },
      undefined,
      { key: "k", value: "J" },
    )
    expect(params).toEqual(["{}", "s1", "J", "failed", "k", "J"])
  })
})

describe("dropRenderKeysSql", () => {
  it("removes every render key from a live slot", () => {
    const { sql, params } = dropRenderKeysSql("stslot_1")
    expect(params).toEqual(["stslot_1"])
    expect(sql).toContain(
      "- ARRAY['render','render_error','render_started_at','render_job','render_shadow','render_unsent_alert','render_summary_claim']::text[]",
    )
    expect(sql).toContain("deleted_at IS NULL")
  })
})
