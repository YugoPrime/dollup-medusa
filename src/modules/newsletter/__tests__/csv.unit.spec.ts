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
    expect(out.unsubscribedCount).toBe(1)
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

  const flags = (csv: string) => parseContactsCsv(csv).rows.map((r) => r.unsubscribed)

  describe("strict unsubscribe parsing (R17)", () => {
    it("unsubscribed column: true / 1 / yes (any case, padded) are unsubscribed", () => {
      expect(
        flags("email,Unsubscribed\na@x.mu,true\nb@x.mu,1\nc@x.mu, Yes \nd@x.mu,TRUE\n")
      ).toEqual([true, true, true, true])
    })

    it("unsubscribed column: false / 0 / no / empty are subscribed", () => {
      expect(flags("email,unsubscribed\na@x.mu,false\nb@x.mu,0\nc@x.mu,No\nd@x.mu,\ne@x.mu\n")).toEqual([
        false,
        false,
        false,
        false,
        false,
      ])
    })

    it("rejects an unrecognised unsubscribed value, naming the 1-based data row and the value", () => {
      expect(() => parseContactsCsv("email,unsubscribed\na@x.mu,false\nb@x.mu,maybe\n")).toThrow(
        'Row 2: unsubscribed value "maybe" not recognised'
      )
      expect(() => parseContactsCsv("email,unsubscribed\na@x.mu,unsubscribed\n")).toThrow(
        'Row 1: unsubscribed value "unsubscribed" not recognised'
      )
    })

    it("subscribed column (no unsubscribed column) is the inverse", () => {
      expect(
        flags("email,subscribed\na@x.mu,true\nb@x.mu,no\nc@x.mu,0\nd@x.mu,YES\ne@x.mu,\n")
      ).toEqual([false, true, true, false, true])
      expect(() => parseContactsCsv("email,subscribed\na@x.mu,sure\n")).toThrow(
        'Row 1: subscribed value "sure" not recognised'
      )
    })

    it("status column (no unsubscribed/subscribed column)", () => {
      expect(
        flags(
          "email,Status\na@x.mu,unsubscribed\nb@x.mu,Inactive\nc@x.mu,subscribed\nd@x.mu,ACTIVE\ne@x.mu,\n"
        )
      ).toEqual([true, true, false, false, false])
      expect(() => parseContactsCsv("email,status\na@x.mu,active\nb@x.mu,active\nc@x.mu,bounced\n")).toThrow(
        'Row 3: status value "bounced" not recognised'
      )
    })

    it("the unsubscribed column wins over subscribed and status", () => {
      expect(flags("email,status,subscribed,unsubscribed\na@x.mu,active,true,true\n")).toEqual([true])
      expect(flags("email,status,subscribed\na@x.mu,unsubscribed,true\n")).toEqual([false])
    })

    it("counts unsubscribed rows after de-dup (first wins) and ignores the flag of invalid-email rows", () => {
      const out = parseContactsCsv(
        "email,unsubscribed\na@x.mu,true\nA@x.mu,false\nb@x.mu,false\nnot-an-email,whatever\nc@x.mu,yes\n"
      )
      expect(out.rows).toEqual([
        { email: "a@x.mu", unsubscribed: true },
        { email: "b@x.mu", unsubscribed: false },
        { email: "c@x.mu", unsubscribed: true },
      ])
      expect(out.invalid).toBe(1)
      expect(out.unsubscribedCount).toBe(2)
    })

    it("no flag column: everyone subscribed, unsubscribedCount 0", () => {
      expect(parseContactsCsv("email,first_name\na@x.mu,Ana\n")).toEqual({
        rows: [{ email: "a@x.mu", unsubscribed: false }],
        invalid: 0,
        unsubscribedCount: 0,
      })
    })
  })
})
