import { classifyImageKind } from "../image-kind"

describe("classifyImageKind", () => {
  it("classifies bare ref as front", () => {
    expect(classifyImageKind("https://r2/IS2328.jpg")).toBe("front")
  })

  it("classifies {ref}-{color} as front (color is not a role suffix)", () => {
    expect(classifyImageKind("https://r2/IS2328-pink.jpg")).toBe("front")
    expect(classifyImageKind("https://r2/IS2328-navy.jpg")).toBe("front")
    expect(classifyImageKind("https://r2/IS2328-white.webp")).toBe("front")
  })

  it("classifies trailing -b as back", () => {
    expect(classifyImageKind("https://r2/IS2328-b.jpg")).toBe("back")
    expect(classifyImageKind("https://r2/IS2328-pink-b.jpg")).toBe("back")
  })

  it("classifies trailing -r as real (on-model)", () => {
    expect(classifyImageKind("https://r2/IS2328-r.jpg")).toBe("real")
    expect(classifyImageKind("https://r2/IS2328-pink-r.jpg")).toBe("real")
  })

  it("classifies trailing -1 as detail/closeup", () => {
    expect(classifyImageKind("https://r2/IS2328-1.jpg")).toBe("detail")
    expect(classifyImageKind("https://r2/IS2328-pink-1.jpg")).toBe("detail")
  })

  it("classifies trailing -s as size_chart", () => {
    expect(classifyImageKind("https://r2/IS2328-s.jpg")).toBe("size_chart")
    expect(classifyImageKind("https://r2/IS2328-pink-s.jpg")).toBe("size_chart")
  })

  it("returns 'other' for numbered trailing tokens that aren't '1' (likely off-convention detail shots)", () => {
    expect(classifyImageKind("https://r2/IS2328-2.jpg")).toBe("other")
    expect(classifyImageKind("https://r2/IS2328-3.jpeg")).toBe("other")
    expect(classifyImageKind("https://r2/IS2328-pink-2.jpg")).toBe("other")
  })

  it("is case-insensitive on suffix and extension", () => {
    expect(classifyImageKind("https://r2/IS2328-R.JPG")).toBe("real")
    expect(classifyImageKind("https://r2/IS2328-B.JPEG")).toBe("back")
    expect(classifyImageKind("https://r2/IS2328-S.PNG")).toBe("size_chart")
  })

  it("handles URLs with query strings and fragments", () => {
    expect(classifyImageKind("https://r2/IS2328-r.jpg?v=2")).toBe("real")
    expect(classifyImageKind("https://r2/IS2328-b.jpg#hash")).toBe("back")
  })

  it("supports common web image extensions", () => {
    expect(classifyImageKind("https://r2/IS2328-r.png")).toBe("real")
    expect(classifyImageKind("https://r2/IS2328-r.webp")).toBe("real")
    expect(classifyImageKind("https://r2/IS2328-r.avif")).toBe("real")
  })

  it("falls back to 'other' for inputs with no extension", () => {
    expect(classifyImageKind("https://r2/IS2328-r")).toBe("other")
    expect(classifyImageKind("")).toBe("other")
  })

  it("classifies hyphenated multi-word colors as front", () => {
    // "navy-blue" → last token "blue" is not a role
    expect(classifyImageKind("https://r2/IS2328-navy-blue.jpg")).toBe("front")
  })

  it("classifies trailing -cutout as cutout (transparent-bg PNG for spotlight template)", () => {
    expect(classifyImageKind("https://r2/IS2328-cutout.png")).toBe("cutout")
    expect(classifyImageKind("https://r2/IS2328-pink-cutout.png")).toBe("cutout")
    expect(classifyImageKind("https://r2/IS2328-CUTOUT.PNG")).toBe("cutout")
    expect(classifyImageKind("https://r2/IS2328-cutout.webp")).toBe("cutout")
  })
})
