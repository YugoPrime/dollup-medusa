import { normalizeSizeLabel, parseSizeCell } from "../lib/sheet-import"

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

describe("parseSizeCell", () => {
  it("parses qty-prefixed tokens (real sheet row 1)", () => {
    expect(parseSizeCell("3S,4M,3L")).toEqual([
      { size: "S", qty: 3 },
      { size: "M", qty: 4 },
      { size: "L", qty: 3 },
    ])
  })

  it("parses Xl as XL (real sheet row 2)", () => {
    expect(parseSizeCell("3S,3M,3L,3Xl")).toEqual([
      { size: "S", qty: 3 },
      { size: "M", qty: 3 },
      { size: "L", qty: 3 },
      { size: "XL", qty: 3 },
    ])
  })

  it("disambiguates Xl (=XL) vs 2XL (=XXL) in the same cell (real sheet row 14)", () => {
    expect(parseSizeCell("3S,3M,2L,2Xl, 2XL")).toEqual([
      { size: "S", qty: 3 },
      { size: "M", qty: 3 },
      { size: "L", qty: 2 },
      { size: "XL", qty: 2 },
      { size: "XXL", qty: 2 },
    ])
  })

  it("parses XS through XXL (real sheet row 15)", () => {
    expect(parseSizeCell("2XS,2S,2M,2L,2XL")).toEqual([
      { size: "XS", qty: 2 },
      { size: "S", qty: 2 },
      { size: "M", qty: 2 },
      { size: "L", qty: 2 },
      { size: "XXL", qty: 2 },
    ])
  })

  it("returns empty array when no qty prefix and free-size phrase (real sheet row 10)", () => {
    // "free size 3 each" is a free-form phrase, not a size token list.
    // It must NOT auto-parse; row-level logic handles it via the Qty column.
    expect(parseSizeCell("free size 3 each")).toEqual([])
  })

  it("defaults missing qty prefix to 1", () => {
    expect(parseSizeCell("S,M,L")).toEqual([
      { size: "S", qty: 1 },
      { size: "M", qty: 1 },
      { size: "L", qty: 1 },
    ])
  })

  it("trims whitespace and tolerates trailing comma", () => {
    expect(parseSizeCell("  3S , 4M , 3L , ")).toEqual([
      { size: "S", qty: 3 },
      { size: "M", qty: 4 },
      { size: "L", qty: 3 },
    ])
  })

  it("returns empty array for empty input", () => {
    expect(parseSizeCell("")).toEqual([])
    expect(parseSizeCell("   ")).toEqual([])
  })
})
