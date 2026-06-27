import { decideDailyPublishAction } from "../feed-planner"

describe("decideDailyPublishAction", () => {
  it("auto-picks when there is no row for the day", () => {
    expect(decideDailyPublishAction(null)).toBe("auto_pick")
  })
  it("publishes an existing planned row", () => {
    expect(decideDailyPublishAction({ status: "planned" })).toBe("publish_existing")
  })
  it("retries (publishes) an existing failed row", () => {
    expect(decideDailyPublishAction({ status: "failed" })).toBe("publish_existing")
  })
  it("skips an already-posted row", () => {
    expect(decideDailyPublishAction({ status: "posted" })).toBe("skip")
  })
  it("skips a skipped row", () => {
    expect(decideDailyPublishAction({ status: "skipped" })).toBe("skip")
  })
})
