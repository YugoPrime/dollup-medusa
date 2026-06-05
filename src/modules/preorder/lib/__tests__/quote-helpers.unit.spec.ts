import { isValidSheinUrl, parseQuoteUrls, parseQuoteUrlsCapped } from "../quote-helpers"
import { rollupRequestStatus } from "../quote-helpers"
import { isLockStale, isDaemonOnline } from "../quote-helpers"

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

describe("rollupRequestStatus", () => {
  const s = (...statuses: string[]) => statuses.map((status) => ({ status }))

  it("all quoted -> quoted", () => {
    expect(rollupRequestStatus(s("quoted", "quoted"))).toBe("quoted")
  })
  it("all reserved -> reserved", () => {
    expect(rollupRequestStatus(s("reserved", "reserved"))).toBe("reserved")
  })
  it("mix of quoted and needs_manual -> partial", () => {
    expect(rollupRequestStatus(s("quoted", "needs_manual"))).toBe("partial")
  })
  it("all needs_manual -> needs_manual", () => {
    expect(rollupRequestStatus(s("needs_manual", "needs_manual"))).toBe("needs_manual")
  })
  it("any still pending/scraping -> pending", () => {
    expect(rollupRequestStatus(s("quoted", "scraping"))).toBe("pending")
    expect(rollupRequestStatus(s("pending", "quoted"))).toBe("pending")
  })
  it("reserved items count as resolved alongside quoted", () => {
    expect(rollupRequestStatus(s("reserved", "quoted"))).toBe("partial")
  })
})

describe("isLockStale", () => {
  const now = new Date("2026-06-06T12:00:00Z")
  it("null lock is stale (reclaimable)", () => {
    expect(isLockStale(null, now, 5)).toBe(true)
  })
  it("lock 6 min old is stale", () => {
    expect(isLockStale(new Date("2026-06-06T11:54:00Z"), now, 5)).toBe(true)
  })
  it("lock 2 min old is fresh", () => {
    expect(isLockStale(new Date("2026-06-06T11:58:00Z"), now, 5)).toBe(false)
  })
})

describe("isDaemonOnline", () => {
  const now = new Date("2026-06-06T12:00:00Z")
  it("heartbeat 2 min ago -> online", () => {
    expect(isDaemonOnline(new Date("2026-06-06T11:58:00Z"), now, 5)).toBe(true)
  })
  it("heartbeat 6 min ago -> offline", () => {
    expect(isDaemonOnline(new Date("2026-06-06T11:54:00Z"), now, 5)).toBe(false)
  })
  it("never seen (null) -> offline", () => {
    expect(isDaemonOnline(null, now, 5)).toBe(false)
  })
})
