import { nextRefFromHandles, parseIsHandle } from "../lib/ref-allocator"

describe("parseIsHandle", () => {
  it.each([
    ["is2382", 2382],
    ["IS2382", 2382],
    ["is1", 1],
    ["is0001", 1],
  ])("parses %s → %d", (h, n) => {
    expect(parseIsHandle(h as string)).toBe(n)
  })

  it.each(["is", "is-1", "is123abc", "alpha", "", "123"])(
    "rejects %s → null",
    (h) => {
      expect(parseIsHandle(h)).toBeNull()
    },
  )
})

describe("nextRefFromHandles", () => {
  it("starts at IS1 when no IS handles exist", () => {
    expect(nextRefFromHandles([])).toBe("IS1")
    expect(nextRefFromHandles(["foo", "bar", "baz"])).toBe("IS1")
  })

  it("returns max+1 across IS handles", () => {
    expect(nextRefFromHandles(["is100", "is2382", "is500"])).toBe("IS2383")
  })

  it("mixes case-insensitive correctly", () => {
    expect(nextRefFromHandles(["is100", "IS2382", "is500"])).toBe("IS2383")
  })

  it("ignores non-IS handles", () => {
    expect(nextRefFromHandles(["t-shirt", "is42", "abc-100"])).toBe("IS43")
  })
})
