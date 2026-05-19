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

  describe("long-form filename convention (current uploads)", () => {
    it("classifies *-front as front", () => {
      // Production CDN files: `is2316-s-blue-front.jpg`, etc.
      expect(classifyImageKind("https://cdn/products/is2316/is2316-s-blue-front.jpg")).toBe("front")
      expect(classifyImageKind("https://cdn/IS2328-front.jpg")).toBe("front")
    })

    it("classifies *-back as back", () => {
      expect(classifyImageKind("https://cdn/products/is2316/is2316-s-blue-back.jpg")).toBe("back")
      expect(classifyImageKind("https://cdn/IS2328-pink-back.jpg")).toBe("back")
    })

    it("classifies *-real as real (on-model)", () => {
      expect(classifyImageKind("https://cdn/products/is2337/is2337-s-beige-real.jpg")).toBe("real")
      expect(classifyImageKind("https://cdn/IS2328-real.jpg")).toBe("real")
    })

    it("classifies *-detail as detail", () => {
      expect(classifyImageKind("https://cdn/products/is2316/is2316-s-blue-detail.jpg")).toBe("detail")
      expect(classifyImageKind("https://cdn/IS2328-detail.jpg")).toBe("detail")
    })

    it("classifies *-sizechart and *-size-chart as size_chart", () => {
      expect(classifyImageKind("https://cdn/IS2328-sizechart.jpg")).toBe("size_chart")
      expect(classifyImageKind("https://cdn/IS2328-size-chart.jpg")).toBe("size_chart")
      expect(classifyImageKind("https://cdn/IS2328-pink-size-chart.jpg")).toBe("size_chart")
    })

    it("is case-insensitive on the long form too", () => {
      expect(classifyImageKind("https://cdn/IS2328-BACK.JPG")).toBe("back")
      expect(classifyImageKind("https://cdn/IS2328-Real.jpg")).toBe("real")
    })

    it("real handling — the picker enforces 'never use real shots' even though they classify correctly", () => {
      // The classifier reports the truth; the picker is responsible for
      // refusing to use real shots in templates per the boutique policy.
      expect(classifyImageKind("https://cdn/IS2328-real.jpg")).toBe("real")
    })
  })
})
