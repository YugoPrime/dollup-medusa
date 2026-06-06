import { isChallengeUrl, classifyFetchOutcome } from "../shein-fetcher"

describe("isChallengeUrl", () => {
  it("flags /risk/challenge redirects", () => {
    expect(isChallengeUrl("https://www.shein.com/risk/challenge?foo=1")).toBe(true)
  })
  it("passes a normal product URL", () => {
    expect(isChallengeUrl("https://www.shein.com/Dress-p-123.html")).toBe(false)
  })
})

describe("classifyFetchOutcome", () => {
  it("404 -> removed", () => {
    expect(classifyFetchOutcome({ status: 404, finalUrl: "x", html: "" }).kind).toBe("removed")
  })
  it("challenge final url -> challenge", () => {
    expect(
      classifyFetchOutcome({ status: 200, finalUrl: "https://www.shein.com/risk/challenge", html: "" }).kind,
    ).toBe("challenge")
  })
  it("200 with parseable goodsDetailSchema -> ok", () => {
    const html = '<script id="goodsDetailSchema">{"@type":"ProductGroup","name":"X"}</script>'
    expect(classifyFetchOutcome({ status: 200, finalUrl: "ok", html }).kind).toBe("ok")
  })
  it("200 without schema -> parse-fail", () => {
    expect(classifyFetchOutcome({ status: 200, finalUrl: "ok", html: "<html></html>" }).kind).toBe("parse-fail")
  })
})
