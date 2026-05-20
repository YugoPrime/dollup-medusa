import { normalizeSizeLabel, parseSizeCell, parseColorCell, parseSourcingSheet } from "../lib/sheet-import"
import fixture from "./fixtures/rahvi-2026-04-06.json"

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

describe("parseColorCell", () => {
  it("returns [null] for blank cell", () => {
    expect(parseColorCell("")).toEqual([null])
    expect(parseColorCell("   ")).toEqual([null])
  })

  it("returns single trimmed color", () => {
    expect(parseColorCell("Brown")).toEqual(["Brown"])
    expect(parseColorCell("  BLACK  ")).toEqual(["Black"])
  })

  it("splits comma-separated multi-color (real sheet row 9 — preserves Brugandy typo)", () => {
    expect(parseColorCell("Brugandy, White,")).toEqual(["Brugandy", "White"])
  })

  it("splits 3-color cell (real sheet row 15)", () => {
    expect(parseColorCell("Black, White, Light Yellow")).toEqual([
      "Black",
      "White",
      "Light Yellow",
    ])
  })

  it("title-cases ALL CAPS but keeps mixed-case as-is", () => {
    expect(parseColorCell("BLACK")).toEqual(["Black"])
    expect(parseColorCell("Light Yellow")).toEqual(["Light Yellow"])
  })
})

describe("parseSourcingSheet — header detection", () => {
  it("finds header on row 0 of the reference sheet", () => {
    const r = parseSourcingSheet(fixture as string[][])
    expect(r.header_row_index).toBe(0)
  })

  it("finds header even with leading blank rows", () => {
    const rows = [["", "", "", "", ""], ["", "", "", "", ""], ...(fixture as string[][])]
    const r = parseSourcingSheet(rows)
    expect(r.header_row_index).toBe(2)
  })

  it("returns empty result when no header is found", () => {
    const r = parseSourcingSheet([["foo", "bar"], ["1", "2"]])
    expect(r.header_row_index).toBe(-1)
    expect(r.rows).toEqual([])
    expect(r.unparseable).toEqual([])
  })
})

describe("parseSourcingSheet — fixture row expansion", () => {
  const result = parseSourcingSheet(fixture as string[][])

  it("produces 16 parsed rows + 0 unparseable", () => {
    expect(result.rows.length).toBe(16)
    expect(result.unparseable.length).toBe(0)
  })

  it("auto-names items Item 1..Item 16", () => {
    expect(result.rows.map((r) => r.working_name)).toEqual(
      Array.from({ length: 16 }, (_, i) => `Item ${i + 1}`),
    )
  })

  it("row 1 (Brown, 3S/4M/3L) — 1 color × 3 sizes = 3 variants summing to 10", () => {
    const r = result.rows[0]
    expect(r.variants).toEqual([
      { color: "Brown", size: "S", qty: 3 },
      { color: "Brown", size: "M", qty: 4 },
      { color: "Brown", size: "L", qty: 3 },
    ])
    expect(r.qty_total).toBe(10)
    expect(r.cost_usd).toBeCloseTo(6.15384615384615)
    expect(r.warnings).toEqual([])
  })

  it("row 9 (Brugandy+White, 3S/3M/2L/2Xl, qty=20) — 2 colors × 4 sizes = 8 variants summing to 20", () => {
    const r = result.rows[8]
    expect(r.variants).toHaveLength(8)
    const total = r.variants.reduce((acc, v) => acc + v.qty, 0)
    expect(total).toBe(20)
    expect(new Set(r.variants.map((v) => v.color))).toEqual(
      new Set(["Brugandy", "White"]),
    )
    expect(r.warnings).toEqual([])
  })

  it("row 10 (free size 3 each, qty=12) — 1 variant size=OS qty=12, raw cell preserved in notes", () => {
    const r = result.rows[9]
    expect(r.variants).toEqual([{ color: null, size: "OS", qty: 12 }])
    expect(r.notes).toBe("free size 3 each")
  })

  it("row 14 (mixed Xl + 2XL, qty=14) — 5 sizes (S/M/L/XL/XXL) summing to 12, with qty-mismatch warning", () => {
    const r = result.rows[13]
    expect(r.variants).toEqual([
      { color: null, size: "S", qty: 3 },
      { color: null, size: "M", qty: 3 },
      { color: null, size: "L", qty: 2 },
      { color: null, size: "XL", qty: 2 },
      { color: null, size: "XXL", qty: 2 },
    ])
    expect(r.qty_total).toBe(14)
    expect(r.warnings).toEqual([
      "qty mismatch: sheet says 14, variants sum to 12",
    ])
  })

  it("row 15 (3 colors × 5 sizes, qty=30) — 15 variants summing to 30", () => {
    const r = result.rows[14]
    expect(r.variants).toHaveLength(15)
    expect(r.variants.reduce((a, v) => a + v.qty, 0)).toBe(30)
    expect(new Set(r.variants.map((v) => v.color))).toEqual(
      new Set(["Black", "White", "Light Yellow"]),
    )
  })

  it("row 16 (BLACK, 3S/4M/3L) — color normalized to Black", () => {
    expect(result.rows[15].variants.map((v) => v.color)).toEqual([
      "Black",
      "Black",
      "Black",
    ])
  })
})
