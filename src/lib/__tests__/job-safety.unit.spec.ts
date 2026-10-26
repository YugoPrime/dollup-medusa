import { alertOnThrow } from "../job-safety"

describe("alertOnThrow", () => {
  it("returns the step's result when it succeeds", async () => {
    const alerts: string[] = []
    expect(await alertOnThrow("publish", async () => 42, async (t) => void alerts.push(t))).toBe(42)
    expect(alerts).toEqual([])
  })

  it("catches a throw, sends one alert naming the step, and returns undefined", async () => {
    const alerts: string[] = []
    const out = await alertOnThrow(
      "grid planning",
      async () => {
        throw new Error('Product category "dresses" not found')
      },
      async (t) => void alerts.push(t),
    )
    expect(out).toBeUndefined()
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toContain("grid planning")
    expect(alerts[0]).toContain('Product category "dresses" not found')
  })

  it("survives an alert that itself fails", async () => {
    await expect(
      alertOnThrow("x", async () => { throw new Error("boom") }, async () => { throw new Error("telegram down") }),
    ).resolves.toBeUndefined()
  })
})
