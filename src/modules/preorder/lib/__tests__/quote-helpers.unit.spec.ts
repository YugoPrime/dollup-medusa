import { isValidSheinUrl, parseQuoteUrls, parseQuoteUrlsCapped } from "../quote-helpers"

describe("isValidSheinUrl", () => {
  it("accepts a shein.com product URL", () => {
    expect(isValidSheinUrl("https://www.shein.com/Aloruh-Dress-p-12345.html")).toBe(true)
  })
  it("accepts regional shein subdomains", () => {
    expect(isValidSheinUrl("https://m.shein.com/x-p-1.html")).toBe(true)
  })
  it("rejects non-shein hosts", () => {
    expect(isValidSheinUrl("https://example.com/x")).toBe(false)
  })
  it("rejects garbage", () => {
    expect(isValidSheinUrl("not a url")).toBe(false)
  })
})

describe("parseQuoteUrls", () => {
  it("splits newline-separated links, trims, drops blanks", () => {
    const input = "https://www.shein.com/a-p-1.html\n\n https://www.shein.com/b-p-2.html \n"
    expect(parseQuoteUrls(input)).toEqual([
      "https://www.shein.com/a-p-1.html",
      "https://www.shein.com/b-p-2.html",
    ])
  })
  it("caps at 5 and reports the overflow count", () => {
    const six = Array.from({ length: 6 }, (_, i) => `https://www.shein.com/x-p-${i}.html`).join("\n")
    const { urls, dropped } = parseQuoteUrlsCapped(six, 5)
    expect(urls).toHaveLength(5)
    expect(dropped).toBe(1)
  })
})
