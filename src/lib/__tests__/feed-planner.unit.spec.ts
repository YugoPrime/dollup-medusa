import { decideDailyPublishAction } from "../feed-planner"

describe("decideDailyPublishAction", () => {
  it("auto-picks when there is no row for the day", () => {
    expect(decideDailyPublishAction(null)).toBe("auto_pick")
  })
  it("publishes an existing planned row", () => {
    expect(decideDailyPublishAction({ status: "planned", attempt_count: 0 })).toBe("publish_existing")
  })
  it("retries a failed row below the 3-attempt cap", () => {
    expect(decideDailyPublishAction({ status: "failed", attempt_count: 2 })).toBe("publish_existing")
  })
  it("gives up on a failed row after 3 attempts", () => {
    expect(decideDailyPublishAction({ status: "failed", attempt_count: 3 })).toBe("skip")
  })
  it("skips an already-posted row", () => {
    expect(decideDailyPublishAction({ status: "posted", attempt_count: 1 })).toBe("skip")
  })
  it("skips a skipped row", () => {
    expect(decideDailyPublishAction({ status: "skipped", attempt_count: 0 })).toBe("skip")
  })
})
