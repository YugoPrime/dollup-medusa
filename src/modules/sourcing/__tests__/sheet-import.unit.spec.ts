import { normalizeSizeLabel } from "../lib/sheet-import"

describe("normalizeSizeLabel", () => {
  const cases: Array<[string, string]> = [
    ["S", "S"],
    ["s", "S"],
    ["m", "M"],
    ["L", "L"],
    ["XS", "XS"],
    ["xs", "XS"],
    ["XL", "XL"],
    ["xl", "XL"],
    ["Xl", "XL"],
    ["1x", "XL"],
    ["1XL", "XL"],
    ["XXL", "XXL"],
    ["xxl", "XXL"],
    ["2xl", "XXL"],
    ["2XL", "XXL"],
    ["XXXL", "XXXL"],
    ["3xl", "XXXL"],
    ["OS", "OS"],
    ["os", "OS"],
    ["one size", "OS"],
    ["free size", "OS"],
    ["freesize", "OS"],
  ]
  it.each(cases)("normalizes %s → %s", (input, expected) => {
    expect(normalizeSizeLabel(input)).toBe(expected)
  })

  it("uppercases and returns unknown tokens unchanged", () => {
    expect(normalizeSizeLabel("foo")).toBe("FOO")
  })

  it("trims whitespace", () => {
    expect(normalizeSizeLabel("  m  ")).toBe("M")
  })
})
