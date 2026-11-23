import { decideAdd, decideImport } from "../lib/subscriber-rules"

describe("decideAdd", () => {
  it("decides per status and source", () => {
    expect(decideAdd(null, "admin")).toBe("create")
    expect(decideAdd({ status: "subscribed" }, "admin")).toBe("noop")
    expect(decideAdd({ status: "unsubscribed" }, "admin")).toBe("resubscribe")
    expect(decideAdd({ status: "unsubscribed" }, "import")).toBe("noop")
    expect(decideAdd({ status: "unsubscribed" }, "footer")).toBe("resubscribe")
  })
})

describe("decideImport", () => {
  it("creates new rows whatever the flag", () => {
    expect(decideImport(null, false)).toBe("create")
    expect(decideImport(null, true)).toBe("create")
  })
  it("unsubscribe wins over an existing subscribed row", () => {
    expect(decideImport({ status: "subscribed" }, true)).toBe("unsubscribe")
  })
  it("skips otherwise", () => {
    expect(decideImport({ status: "subscribed" }, false)).toBe("skip")
    expect(decideImport({ status: "unsubscribed" }, false)).toBe("skip")
    expect(decideImport({ status: "unsubscribed" }, true)).toBe("skip")
  })
})
