import { readFileSync } from "fs"
import { join } from "path"
import { extractFromShein } from "../shein-extract"

const fixture = (name: string) =>
  readFileSync(join(__dirname, "fixtures/shein", name), "utf8")

describe("extractFromShein", () => {
  it("extracts title, price, sizes, and per-color images from a multi-color dress", () => {
    const html = fixture("dress-multicolor.html")
    const result = extractFromShein(html)
    expect(result).not.toBeNull()
    expect(result!.title.length).toBeGreaterThan(0)
    expect(result!.sheinPriceUsd).toBeGreaterThan(0)
    expect(result!.sizes.length).toBeGreaterThanOrEqual(2)
    expect(result!.colors.length).toBeGreaterThanOrEqual(2)
    for (const c of result!.colors) {
      expect(c.name.length).toBeGreaterThan(0)
      expect(c.images.length).toBeGreaterThanOrEqual(1)
      for (const url of c.images) {
        expect(url).toMatch(/^https:\/\/img\.ltwebstatic\.com\//)
      }
    }
    expect(result!.stockAvailable).toBe(true)
  })

  it("extracts a single-color product without throwing", () => {
    const html = fixture("single-color.html")
    const result = extractFromShein(html)
    expect(result).not.toBeNull()
    expect(result!.colors.length).toBe(1)
    expect(result!.stockAvailable).toBe(true)
  })

  it("reports stockAvailable=false for a sold-out product", () => {
    const html = fixture("sold-out.html")
    const result = extractFromShein(html)
    expect(result).not.toBeNull()
    expect(result!.stockAvailable).toBe(false)
  })

  it("returns null when neither gbProductSsrData nor JSON-LD are present", () => {
    const result = extractFromShein("<html><body>Not SHEIN</body></html>")
    expect(result).toBeNull()
  })
})
