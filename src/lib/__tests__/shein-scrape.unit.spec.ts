import { buildQuotePayload } from "../shein-scrape"

const HTML_OK = `
<script id="goodsDetailSchema">{
  "@type":"ProductGroup","name":"Floral Cami Dress","productGroupID":"123",
  "image":["//img.ltwebstatic.com/a.jpg"],
  "color":"Blue",
  "hasVariant":[
    {"sku":"s1","size":"S","offers":{"price":"12.50","priceCurrency":"USD","availability":"https://schema.org/InStock"}},
    {"sku":"s2","size":"M","offers":{"price":"12.50","priceCurrency":"USD","availability":"https://schema.org/InStock"}}
  ]
}</script>`

const fakePreview = (usd: number) => ({
  sheinPriceUsd: usd,
  sheinPriceMur: usd * 50,
  finalPriceMur: 1040,
  fxRateUsed: 50,
  customsAmount: 0,
  landedCost: 0,
  handlingFee: 0,
  rawPrice: 0,
})

describe("buildQuotePayload", () => {
  it("parses title/price/sizes and produces a quoted payload", async () => {
    const out = await buildQuotePayload(HTML_OK, { previewPrice: async (u) => fakePreview(u), settingsSnapshot: { id: "s" } })
    expect(out.outcome).toBe("quoted")
    expect(out.scraped_title).toBe("Floral Cami Dress")
    expect(out.scraped_price_usd).toBe(12.5)
    expect(out.all_in_price_mur).toBe(1040)
    expect(out.size_options).toEqual(["S", "M"])
  })

  it("normalizes a protocol-relative thumbnail to https", async () => {
    const out = await buildQuotePayload(HTML_OK, { previewPrice: async (u) => fakePreview(u), settingsSnapshot: { id: "s" } })
    expect(out.scraped_thumbnail).toBe("https://img.ltwebstatic.com/a.jpg")
  })

  it("html with no schema -> parse-fail outcome (needs_manual)", async () => {
    const out = await buildQuotePayload("<html></html>", { previewPrice: async (u) => fakePreview(u), settingsSnapshot: { id: "s" } })
    expect(out.outcome).toBe("needs_manual")
    expect(out.last_error_kind).toBe("parse-fail")
  })

  it("all variants out of stock -> failed, no price", async () => {
    const oos = HTML_OK.replace(/InStock/g, "OutOfStock")
    const out = await buildQuotePayload(oos, { previewPrice: async (u) => fakePreview(u), settingsSnapshot: { id: "s" } })
    expect(out.outcome).toBe("failed")
  })

  it("already-absolute https thumbnail passes through unchanged", async () => {
    const html = HTML_OK.replace("//img.ltwebstatic.com/a.jpg", "https://img.ltwebstatic.com/a.jpg")
    const out = await buildQuotePayload(html, { previewPrice: async (u) => fakePreview(u), settingsSnapshot: { id: "s" } })
    expect(out.scraped_thumbnail).toBe("https://img.ltwebstatic.com/a.jpg")
  })

  it("non-finite price -> needs_manual/parse-fail", async () => {
    const html = HTML_OK.replace(/"price":"12.50"/g, '"price":"N/A"')
    const out = await buildQuotePayload(html, { previewPrice: async (u) => fakePreview(u), settingsSnapshot: { id: "s" } })
    expect(out.outcome).toBe("needs_manual")
    expect(out.last_error_kind).toBe("parse-fail")
  })

  it("empty image array -> null thumbnail, still quoted", async () => {
    const html = HTML_OK.replace('"image":["//img.ltwebstatic.com/a.jpg"]', '"image":[]')
    const out = await buildQuotePayload(html, { previewPrice: async (u) => fakePreview(u), settingsSnapshot: { id: "s" } })
    expect(out.outcome).toBe("quoted")
    expect(out.scraped_thumbnail).toBeNull()
  })
})
