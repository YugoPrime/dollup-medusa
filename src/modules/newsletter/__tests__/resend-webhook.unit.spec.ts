import { createHmac } from "crypto"

import { handleResendEvent, type NewEventRow, type ResendHookDeps } from "../handle-resend-event"
import { classifyLink, parseResendEvent } from "../lib/resend-event"
import { verifySvixSignature } from "../lib/svix"

const SECRET_BYTES = Buffer.from("0123456789abcdef0123456789abcdef")
const SECRET = "whsec_" + SECRET_BYTES.toString("base64")
const sign = (id: string, ts: string, body: string, key = SECRET_BYTES) =>
  "v1," + createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64")

describe("verifySvixSignature", () => {
  const body = '{"type":"email.opened"}'
  const ts = "1764190000"
  const base = { payload: body, id: "msg_1", timestamp: ts, secret: SECRET, nowSeconds: 1764190010 }

  it("accepts a valid signature, also among several", () => {
    expect(verifySvixSignature({ ...base, signature: sign("msg_1", ts, body) })).toBe(true)
    expect(verifySvixSignature({ ...base, signature: `v1,AAAA ${sign("msg_1", ts, body)}` })).toBe(true)
  })

  it("rejects a tampered body, a wrong key, a missing header or an empty secret", () => {
    const sig = sign("msg_1", ts, body)
    expect(verifySvixSignature({ ...base, payload: body + " ", signature: sig })).toBe(false)
    expect(verifySvixSignature({ ...base, signature: sign("msg_1", ts, body, Buffer.from("other-key-other-key")) })).toBe(false)
    expect(verifySvixSignature({ ...base, signature: undefined })).toBe(false)
    expect(verifySvixSignature({ ...base, secret: "", signature: sig })).toBe(false)
  })

  it("rejects a stale timestamp (replay)", () => {
    expect(
      verifySvixSignature({ ...base, signature: sign("msg_1", ts, body), nowSeconds: 1764190000 + 600 })
    ).toBe(false)
  })
})

describe("parseResendEvent", () => {
  it("reads a click with its link and the click time", () => {
    const e = parseResendEvent({
      type: "email.clicked",
      created_at: "2026-11-27T10:00:05Z",
      data: {
        broadcast_id: "b1",
        email_id: "e1",
        to: ["Anna@Gmail.com"],
        click: { link: "https://dollupboutique.com/products/red-dress?utm_source=newsletter", timestamp: "2026-11-27T10:00:00Z" },
      },
    })
    expect(e).toEqual({
      kind: "email",
      type: "clicked",
      broadcastId: "b1",
      emailId: "e1",
      email: "anna@gmail.com",
      link: "https://dollupboutique.com/products/red-dress?utm_source=newsletter",
      bounceType: null,
      occurredAt: new Date("2026-11-27T10:00:00Z"),
    })
  })

  it("keeps the bounce type, marks order emails as having no broadcast", () => {
    const b = parseResendEvent({
      type: "email.bounced",
      created_at: "2026-11-27T10:00:00Z",
      data: { email_id: "e2", to: ["x@y.com"], bounce: { type: "Permanent" } },
    })
    expect(b).toMatchObject({ kind: "email", type: "bounced", broadcastId: null, bounceType: "Permanent" })
  })

  it("only treats contact.updated with unsubscribed: true as an unsubscribe", () => {
    expect(parseResendEvent({ type: "contact.updated", data: { email: "A@b.com", unsubscribed: true } })).toEqual({
      kind: "contact_unsubscribed",
      email: "a@b.com",
    })
    expect(parseResendEvent({ type: "contact.updated", data: { email: "a@b.com", unsubscribed: false } }).kind).toBe("ignored")
    expect(parseResendEvent({ type: "email.sent", data: { email_id: "e" } }).kind).toBe("ignored")
    expect(parseResendEvent(null).kind).toBe("ignored")
  })
})

describe("classifyLink", () => {
  const store = "https://dollupboutique.com"
  it("finds product handles and groups other links by path", () => {
    expect(classifyLink("https://dollupboutique.com/products/satin-midi?utm_campaign=x", store)).toEqual({ kind: "product", handle: "satin-midi" })
    expect(classifyLink("https://dollupboutique.com/sale?utm_source=newsletter", store)).toEqual({ kind: "other", label: "/sale" })
    expect(classifyLink("https://dollupboutique.com/?x=1", store)).toEqual({ kind: "other", label: "/" })
    expect(classifyLink("https://instagram.com/dollup", store)).toEqual({ kind: "other", label: "instagram.com/dollup" })
  })
})

describe("handleResendEvent", () => {
  function deps(over: Partial<ResendHookDeps> = {}) {
    const rows: NewEventRow[] = []
    const unsubs: Array<[string | null, string]> = []
    const resendUnsubs: string[] = []
    const d: ResendHookDeps = {
      findCampaignByBroadcast: async (id) => (id === "b1" ? { id: "nlcamp_1", list: "main" } : null),
      recordEvent: async (row) => {
        if (rows.some((r) => r.svix_id === row.svix_id)) return "duplicate"
        rows.push(row)
        return "created"
      },
      unsubscribe: async (list, email) => {
        unsubs.push([list, email])
        return 1
      },
      unsubscribeInResend: async (email) => {
        resendUnsubs.push(email)
      },
      logger: { error: () => undefined, warn: () => undefined },
      ...over,
    }
    return { d, rows, unsubs, resendUnsubs }
  }
  const email = (type: string, extra: Record<string, unknown> = {}) =>
    parseResendEvent({
      type: `email.${type}`,
      created_at: "2026-11-27T10:00:00Z",
      data: { broadcast_id: "b1", email_id: "e1", to: ["a@b.com"], ...extra },
    })

  it("stores newsletter events once, even when Resend retries", async () => {
    const { d, rows } = deps()
    expect(await handleResendEvent(d, email("opened"), "msg_1")).toBe("recorded opened")
    expect(await handleResendEvent(d, email("opened"), "msg_1")).toBe("duplicate")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ campaign_id: "nlcamp_1", type: "opened", email: "a@b.com" })
  })

  it("ignores order emails and unknown broadcasts", async () => {
    const { d, rows } = deps()
    expect(await handleResendEvent(d, email("delivered", { broadcast_id: undefined }), "m1")).toMatch(/not a newsletter/)
    expect(await handleResendEvent(d, email("delivered", { broadcast_id: "other" }), "m2")).toMatch(/unknown broadcast/)
    expect(rows).toHaveLength(0)
  })

  it("unsubscribes hard bounces and complaints, not soft bounces", async () => {
    const { d, unsubs, resendUnsubs } = deps()
    await handleResendEvent(d, email("bounced", { bounce: { type: "Transient" } }), "m1")
    expect(unsubs).toEqual([])
    await handleResendEvent(d, email("bounced", { bounce: { type: "Permanent" } }), "m2")
    await handleResendEvent(d, email("complained"), "m3")
    expect(unsubs).toEqual([["main", "a@b.com"], ["main", "a@b.com"]])
    expect(resendUnsubs).toEqual(["a@b.com", "a@b.com"])
  })

  it("still records the unsubscribe when Resend's contact update fails", async () => {
    const { d, unsubs } = deps({ unsubscribeInResend: async () => { throw new Error("429") } })
    expect(await handleResendEvent(d, email("complained"), "m1")).toBe("recorded complained, unsubscribed")
    expect(unsubs).toHaveLength(1)
  })

  it("mirrors an unsubscribe from Resend onto every list", async () => {
    const { d, unsubs } = deps()
    const e = parseResendEvent({ type: "contact.updated", data: { email: "a@b.com", unsubscribed: true } })
    expect(await handleResendEvent(d, e, "m1")).toBe("unsubscribed")
    expect(unsubs).toEqual([[null, "a@b.com"]])
  })

  it("lets a database failure throw so the route answers 500 and Resend retries", async () => {
    const { d } = deps({ recordEvent: async () => { throw new Error("db down") } })
    await expect(handleResendEvent(d, email("opened"), "m1")).rejects.toThrow("db down")
  })
})
