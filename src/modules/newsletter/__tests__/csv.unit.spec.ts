import { parseContactsCsv } from "../lib/csv"

describe("parseContactsCsv", () => {
  it("parses a Resend export", () => {
    const csv =
      "\uFEFFid,email,first_name,last_name,created_at,unsubscribed\r\n" +
      'c1,Ana@x.mu,"Ana, M",,2026-10-01,false\r\nc2,bob@x.mu,,,2026-10-02,true\r\nc3,bad,,,,false\r\nc4,ana@x.mu,,,,false\r\n'
    const out = parseContactsCsv(csv)
    expect(out.rows).toEqual([
      { email: "ana@x.mu", unsubscribed: false },
      { email: "bob@x.mu", unsubscribed: true },
    ])
    expect(out.invalid).toBe(1)
  })
  it("throws without an email column", () => {
    expect(() => parseContactsCsv("name\nfoo")).toThrow(/email column/)
  })
  it("treats unsubscribed column as optional", () => {
    expect(parseContactsCsv("email\nz@x.mu").rows).toEqual([
      { email: "z@x.mu", unsubscribed: false },
    ])
  })
  it("handles escaped quotes", () => {
    const out = parseContactsCsv('Email,first_name\nq@x.mu,"a ""b"" c"\n')
    expect(out.rows).toEqual([{ email: "q@x.mu", unsubscribed: false }])
  })
})
