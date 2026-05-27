import { readFileSync } from "fs"
import { join } from "path"
import {
  extractJsonLd,
  extractSiblingColors,
  buildSiblingUrl,
} from "../shein-extract"

const fixture = (name: string) =>
  readFileSync(join(__dirname, "fixtures/shein", name), "utf8")

describe("extractJsonLd", () => {
  it("parses ProductGroup from multi-color Aloruh parent (color = Orange, >=4 images)", () => {
    const html = fixture("aloruh-multicolor-parent.html")
    const pg = extractJsonLd(html)
    expect(pg).not.toBeNull()
    expect(pg!.name).toMatch(/Aloruh/i)
    expect(pg!.color).toBe("Orange")
    expect(pg!.image.length).toBeGreaterThanOrEqual(4)
    for (const url of pg!.image) {
      expect(url).toMatch(/^https:\/\/img\.ltwebstatic\.com\//)
    }
    expect(pg!.hasVariant.length).toBeGreaterThanOrEqual(2)
    const sizes = pg!.hasVariant.map((v) => v.size)
    expect(sizes).toEqual(expect.arrayContaining(["S", "M"]))
    const availabilities = new Set(
      pg!.hasVariant.map((v) => v.offers.availability),
    )
    expect(availabilities.has("https://schema.org/InStock")).toBe(true)
  })

  it("parses a sibling color's JSON-LD (Light Yellow has >=4 images)", () => {
    const html = fixture("aloruh-light-yellow-sibling.html")
    const pg = extractJsonLd(html)
    expect(pg).not.toBeNull()
    expect(pg!.color).toBe("Light Yellow")
    expect(pg!.image.length).toBeGreaterThanOrEqual(4)
  })

  it("parses a single-color product (Amorya)", () => {
    const html = fixture("amorya-single-color.html")
    const pg = extractJsonLd(html)
    expect(pg).not.toBeNull()
    expect(pg!.color.length).toBeGreaterThan(0)
    expect(pg!.image.length).toBeGreaterThanOrEqual(4)
  })

  it("returns null when no goodsDetailSchema script is present", () => {
    expect(extractJsonLd("<html><body>nothing</body></html>")).toBeNull()
  })

  it("returns hasVariant[].offers.price as a string (may be '0.00')", () => {
    const html = fixture("aloruh-multicolor-parent.html")
    const pg = extractJsonLd(html)!
    expect(typeof pg.hasVariant[0].offers.price).toBe("string")
  })
})

describe("extractSiblingColors", () => {
  it("extracts ~20 sibling colors from the Aloruh parent page", () => {
    const html = fixture("aloruh-multicolor-parent.html")
    const siblings = extractSiblingColors(html)
    expect(siblings.length).toBeGreaterThanOrEqual(15)
    for (const s of siblings) {
      expect(s.color_name.length).toBeGreaterThan(0)
      expect(s.goods_id).toMatch(/^\d+$/)
      expect(s.goods_url_name.length).toBeGreaterThan(0)
    }
    const names = siblings.map((s) => s.color_name)
    expect(names).toEqual(expect.arrayContaining(["Light Yellow", "Black"]))
    const current = siblings.find((s) => s.goods_id === "415495791")
    expect(current?.color_name).toBe("Orange")
  })

  it("returns empty array on a page without mainSaleAttribute", () => {
    expect(extractSiblingColors("<html><body>nothing</body></html>")).toEqual(
      [],
    )
  })

  it("Amorya page returns 0-3 siblings (may include self)", () => {
    // Amorya has 2 attr_id:"27" entries — may be the current page + 1 sibling,
    // or 2 siblings without self. Either is fine; just check it doesn't throw
    // and yields non-negative count.
    const html = fixture("amorya-single-color.html")
    const siblings = extractSiblingColors(html)
    expect(siblings.length).toBeGreaterThanOrEqual(0)
    expect(siblings.length).toBeLessThanOrEqual(3)
  })
})

describe("buildSiblingUrl", () => {
  it("builds a SHEIN PDP URL from a sibling entry", () => {
    expect(
      buildSiblingUrl({
        color_name: "Light Yellow",
        goods_id: "373210897",
        goods_url_name:
          "Aloruh Women s Solid Color Casual Halter Mini Bubble Dress",
        goods_color_image: "//x",
        goods_image: "//y",
      }),
    ).toBe(
      "https://www.shein.com/Aloruh-Women-s-Solid-Color-Casual-Halter-Mini-Bubble-Dress-p-373210897.html",
    )
  })
})
