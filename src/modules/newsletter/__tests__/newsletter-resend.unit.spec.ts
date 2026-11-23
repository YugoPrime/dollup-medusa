import { MedusaError } from "@medusajs/framework/utils"

import {
  BroadcastRefusedError,
  BroadcastUnconfirmedError,
  createNewsletterResend,
  getNewsletterConfig,
  requireSegment,
  type NewsletterConfig,
  type ResendLike,
} from "../newsletter-resend"

const config: NewsletterConfig = {
  apiKey: "k",
  from: "Doll Up Team <hello@dollupboutique.com>",
  replyTo: "hello@dollupboutique.com",
  segments: { main: "seg_main", after_dark: null },
  storefrontUrl: "https://dollupboutique.com",
}

function makeFake() {
  return {
    contacts: {
      create: jest.fn(),
      get: jest.fn(),
      list: jest.fn(),
      update: jest.fn(),
      segments: { add: jest.fn() },
    },
    broadcasts: { create: jest.fn() },
    emails: { send: jest.fn() },
  }
}

const NOT_FOUND = { data: null, error: { statusCode: 404, name: "not_found", message: "Contact not found" } }

describe("newsletter-resend", () => {
  let fake: ReturnType<typeof makeFake>
  let sleep: jest.Mock
  let clock: number
  let r: ReturnType<typeof createNewsletterResend>

  beforeEach(() => {
    fake = makeFake()
    // A fake clock that only moves when the wrapper sleeps, so pacing is deterministic.
    clock = 0
    sleep = jest.fn(async (ms: number) => {
      clock += ms
    })
    r = createNewsletterResend(config, fake as unknown as ResendLike, { sleep, now: () => clock })
  })

  describe("ensureContact", () => {
    it("creates a new contact with the segment and no unsubscribed key", async () => {
      fake.contacts.get.mockResolvedValue(NOT_FOUND)
      fake.contacts.create.mockResolvedValue({ data: { id: "ct_1" }, error: null })
      expect(await r.ensureContact("a@x.mu", "seg_main", false)).toEqual({ ok: true, contactId: "ct_1" })
      expect(fake.contacts.create).toHaveBeenCalledWith({ email: "a@x.mu", segments: [{ id: "seg_main" }] })
    })

    it("imports a new contact as unsubscribed when asked", async () => {
      fake.contacts.get.mockResolvedValue(NOT_FOUND)
      fake.contacts.create.mockResolvedValue({ data: { id: "ct_1" }, error: null })
      expect(await r.ensureContact("u@x.mu", "seg_main", true)).toEqual({ ok: true, contactId: "ct_1" })
      expect(fake.contacts.create).toHaveBeenLastCalledWith({
        email: "u@x.mu",
        segments: [{ id: "seg_main" }],
        unsubscribed: true,
      })
    })

    it("only adds the segment for an existing contact, even an unsubscribed one", async () => {
      fake.contacts.get.mockResolvedValue({ data: { id: "ct_9", email: "a@x.mu", unsubscribed: true }, error: null })
      fake.contacts.segments.add.mockResolvedValue({ data: { id: "seg_main" }, error: null })
      expect(await r.ensureContact("a@x.mu", "seg_main", false)).toEqual({ ok: true, contactId: "ct_9" })
      expect(fake.contacts.segments.add).toHaveBeenCalledWith({ email: "a@x.mu", segmentId: "seg_main" })
      expect(fake.contacts.create).not.toHaveBeenCalled()
      expect(fake.contacts.update).not.toHaveBeenCalled()
    })

    it("reports a segments.add error on an existing contact", async () => {
      fake.contacts.get.mockResolvedValue({ data: { id: "ct_9", email: "a@x.mu", unsubscribed: false }, error: null })
      fake.contacts.segments.add.mockResolvedValue({ data: null, error: { statusCode: 422, name: "x", message: "no segment" } })
      expect(await r.ensureContact("a@x.mu", "seg_main", false)).toEqual({ ok: false, error: "no segment" })
    })

    it("handles the create race (already exists) with a segment add, no update", async () => {
      fake.contacts.get.mockResolvedValue(NOT_FOUND)
      fake.contacts.create.mockResolvedValue({ data: null, error: { statusCode: 409, name: "conflict", message: "Contact already exists" } })
      fake.contacts.segments.add.mockResolvedValue({ data: { id: "seg_main" }, error: null })
      expect(await r.ensureContact("a@x.mu", "seg_main", false)).toEqual({ ok: true, contactId: null })
      expect(fake.contacts.segments.add).toHaveBeenCalledWith({ email: "a@x.mu", segmentId: "seg_main" })
      expect(fake.contacts.update).not.toHaveBeenCalled()
    })

    it("reports other create errors instead of throwing", async () => {
      fake.contacts.get.mockResolvedValue(NOT_FOUND)
      fake.contacts.create.mockResolvedValue({ data: null, error: { statusCode: 422, name: "validation_error", message: "bad" } })
      expect(await r.ensureContact("a@x.mu", "seg_main", false)).toEqual({ ok: false, error: "bad" })
    })

    it("reports a non-404 get error without creating", async () => {
      fake.contacts.get.mockResolvedValue({ data: null, error: { statusCode: 500, name: "x", message: "boom" } })
      expect(await r.ensureContact("a@x.mu", "seg_main", false)).toEqual({ ok: false, error: "boom" })
      expect(fake.contacts.create).not.toHaveBeenCalled()
    })

    it("retries a 429 then succeeds", async () => {
      fake.contacts.get
        .mockResolvedValueOnce({ data: null, error: { statusCode: 429, name: "rate_limit_exceeded", message: "Too many requests" } })
        .mockResolvedValueOnce({ data: { id: "ct_5", email: "r@x.mu", unsubscribed: false }, error: null })
      fake.contacts.segments.add.mockResolvedValue({ data: {}, error: null })
      expect(await r.ensureContact("r@x.mu", "seg_main", false)).toEqual({ ok: true, contactId: "ct_5" })
      expect(sleep).toHaveBeenCalledWith(1000)
    })

    it("gives up after 3 retries and returns the 429 error", async () => {
      fake.contacts.get.mockResolvedValue({ data: null, error: { statusCode: 429, name: "rate_limit_exceeded", message: "slow down" } })
      expect(await r.ensureContact("r@x.mu", "seg_main", false)).toEqual({ ok: false, error: "slow down" })
      expect(fake.contacts.get).toHaveBeenCalledTimes(4)
      expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 3000])
    })
  })

  describe("ensureContact hardening", () => {
    it("treats an already-in-segment add error as success", async () => {
      fake.contacts.get.mockResolvedValue({ data: { id: "ct_9", email: "a@x.mu", unsubscribed: false }, error: null })
      fake.contacts.segments.add.mockResolvedValue({ data: null, error: { statusCode: 422, name: "x", message: "Contact is already in segment" } })
      expect(await r.ensureContact("a@x.mu", "seg_main", false)).toEqual({ ok: true, contactId: "ct_9" })
      fake.contacts.segments.add.mockResolvedValue({ data: null, error: { statusCode: 409, name: "conflict", message: "dup" } })
      expect(await r.ensureContact("a@x.mu", "seg_main", false)).toEqual({ ok: true, contactId: "ct_9" })
    })

    it("returns ok:false when the SDK throws", async () => {
      fake.contacts.get.mockRejectedValue(new Error("network down"))
      expect(await r.ensureContact("a@x.mu", "seg_main", false)).toEqual({ ok: false, error: "network down" })
    })

    it("does not retry a 429 that is a quota error", async () => {
      fake.contacts.get.mockResolvedValue({ data: null, error: { statusCode: 429, name: "daily_quota_exceeded", message: "daily quota" } })
      expect(await r.ensureContact("a@x.mu", "seg_main", false)).toEqual({ ok: false, error: "daily quota" })
      expect(fake.contacts.get).toHaveBeenCalledTimes(1)
      expect(sleep).not.toHaveBeenCalled()
    })
  })

  describe("listSegmentEmails", () => {
    it("pages with after=last id, normalises emails and splits by unsubscribed", async () => {
      fake.contacts.list
        .mockResolvedValueOnce({ data: { has_more: true, data: [{ id: "1", email: "A@x.mu", unsubscribed: true }, { id: "2", email: " B@x.mu ", unsubscribed: false }] }, error: null })
        .mockResolvedValueOnce({ data: { has_more: false, data: [{ id: "3", email: "c@x.mu", unsubscribed: true }, { id: "4", email: "not-an-email", unsubscribed: false }] }, error: null })
      expect(await r.listSegmentEmails("seg_main")).toEqual({
        subscribed: ["b@x.mu"],
        unsubscribed: ["a@x.mu", "c@x.mu"],
      })
      expect(fake.contacts.list).toHaveBeenCalledTimes(2)
      expect(fake.contacts.list).toHaveBeenNthCalledWith(1, { segmentId: "seg_main", limit: 100 })
      expect(fake.contacts.list).toHaveBeenNthCalledWith(2, { segmentId: "seg_main", limit: 100, after: "2" })
    })

    it("throws on a list error", async () => {
      fake.contacts.list.mockResolvedValue({ data: null, error: { statusCode: 500, name: "x", message: "list failed" } })
      await expect(r.listSegmentEmails("seg_main")).rejects.toThrow(/list failed/)
    })
  })

  describe("pacing (R19)", () => {
    it("spaces two back-to-back calls 250 ms apart", async () => {
      fake.contacts.update.mockResolvedValue({ data: { id: "1" }, error: null })
      await r.setUnsubscribed("a@x.mu")
      expect(sleep).not.toHaveBeenCalled()
      await r.setUnsubscribed("b@x.mu")
      expect(sleep.mock.calls).toEqual([[250]])
    })

    it("waits only the remainder when time already passed, and not at all after 250 ms", async () => {
      fake.contacts.update.mockResolvedValue({ data: { id: "1" }, error: null })
      await r.setUnsubscribed("a@x.mu")
      clock += 100
      await r.setUnsubscribed("b@x.mu")
      expect(sleep.mock.calls).toEqual([[150]])
      clock += 300
      await r.setUnsubscribed("c@x.mu")
      expect(sleep.mock.calls).toEqual([[150]])
    })

    it("paces every SDK call, including the ones inside one method", async () => {
      fake.contacts.get.mockResolvedValue(NOT_FOUND)
      fake.contacts.create.mockResolvedValue({ data: { id: "ct_1" }, error: null })
      await r.ensureContact("a@x.mu", "seg_main", false)
      expect(sleep.mock.calls).toEqual([[250]])
    })

    it("queues concurrent calls instead of firing them together", async () => {
      const starts: number[] = []
      fake.contacts.update.mockImplementation(async () => {
        starts.push(clock)
        return { data: { id: "1" }, error: null }
      })
      await Promise.all([r.setUnsubscribed("a@x.mu"), r.setUnsubscribed("b@x.mu"), r.setUnsubscribed("c@x.mu")])
      expect(starts).toEqual([0, 250, 500])
    })

    it("still paces after a call that threw", async () => {
      fake.contacts.update
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValueOnce({ data: { id: "1" }, error: null })
      await expect(r.setUnsubscribed("a@x.mu")).rejects.toThrow("network")
      await r.setUnsubscribed("b@x.mu")
      expect(sleep.mock.calls).toEqual([[250]])
    })
  })

  describe("setUnsubscribed / resubscribe", () => {
    it("setUnsubscribed updates with unsubscribed: true", async () => {
      fake.contacts.update.mockResolvedValue({ data: { id: "1" }, error: null })
      await r.setUnsubscribed("a@x.mu")
      expect(fake.contacts.update).toHaveBeenCalledWith({ email: "a@x.mu", unsubscribed: true })
    })

    it("setUnsubscribed ignores 404 and throws other errors", async () => {
      fake.contacts.update.mockResolvedValueOnce(NOT_FOUND)
      await expect(r.setUnsubscribed("a@x.mu")).resolves.toBeUndefined()
      fake.contacts.update.mockResolvedValueOnce({ data: null, error: { statusCode: 500, name: "x", message: "nope" } })
      await expect(r.setUnsubscribed("a@x.mu")).rejects.toThrow("nope")
    })

    it("resubscribe updates with unsubscribed: false then ensures the contact", async () => {
      fake.contacts.update.mockResolvedValue({ data: { id: "1" }, error: null })
      fake.contacts.get.mockResolvedValue({ data: { id: "1", email: "a@x.mu", unsubscribed: false }, error: null })
      fake.contacts.segments.add.mockResolvedValue({ data: {}, error: null })
      await r.resubscribe("a@x.mu", "seg_main")
      expect(fake.contacts.update).toHaveBeenCalledWith({ email: "a@x.mu", unsubscribed: false })
      expect(fake.contacts.segments.add).toHaveBeenCalledWith({ email: "a@x.mu", segmentId: "seg_main" })
    })

    it("resubscribe on an update 404 falls through to ensureContact, which creates the contact", async () => {
      fake.contacts.update.mockResolvedValue(NOT_FOUND)
      fake.contacts.get.mockResolvedValue(NOT_FOUND)
      fake.contacts.create.mockResolvedValue({ data: { id: "ct_new" }, error: null })
      await expect(r.resubscribe("a@x.mu", "seg_main")).resolves.toBeUndefined()
      expect(fake.contacts.create).toHaveBeenCalledWith({ email: "a@x.mu", segments: [{ id: "seg_main" }] })
    })

    it("resubscribe rejects when the segment add fails", async () => {
      fake.contacts.update.mockResolvedValue({ data: { id: "1" }, error: null })
      fake.contacts.get.mockResolvedValue({ data: { id: "1", email: "a@x.mu", unsubscribed: false }, error: null })
      fake.contacts.segments.add.mockResolvedValue({ data: null, error: { statusCode: 422, name: "x", message: "segment gone" } })
      await expect(r.resubscribe("a@x.mu", "seg_main")).rejects.toThrow("segment gone")
    })

    it("resubscribe throws when the update errors", async () => {
      fake.contacts.update.mockResolvedValue({ data: null, error: { statusCode: 500, name: "x", message: "upd failed" } })
      await expect(r.resubscribe("a@x.mu", "seg_main")).rejects.toThrow("upd failed")
    })
  })

  describe("broadcasts and test sends", () => {
    const send = () => r.createAndSendBroadcast({ segmentId: "s", subject: "x", html: "<p/>", name: "n" })
    const caught = async (): Promise<unknown> => {
      try {
        await send()
      } catch (e) {
        return e
      }
      throw new Error("expected createAndSendBroadcast to throw")
    }

    it("surfaces the Resend message and sends with the right shape", async () => {
      fake.broadcasts.create.mockResolvedValue({ data: null, error: { statusCode: 403, name: "validation_error", message: "You have reached your contacts quota." } })
      await expect(send()).rejects.toThrow(/contacts quota/)
      expect(fake.broadcasts.create).toHaveBeenCalledWith(
        expect.objectContaining({ segmentId: "s", send: true, from: "Doll Up Team <hello@dollupboutique.com>", replyTo: "hello@dollupboutique.com" })
      )
    })

    it("a 4xx is a definite refusal (BroadcastRefusedError with Resend's message)", async () => {
      fake.broadcasts.create.mockResolvedValue({ data: null, error: { statusCode: 403, name: "validation_error", message: "You have reached your contacts quota." } })
      const e403 = await caught()
      expect(e403).toBeInstanceOf(BroadcastRefusedError)
      expect((e403 as Error).message).toBe("You have reached your contacts quota.")
      fake.broadcasts.create.mockResolvedValue({ data: null, error: { statusCode: 422, name: "validation_error", message: "segment not found" } })
      expect(await caught()).toBeInstanceOf(BroadcastRefusedError)
    })

    it("a 429 rate limit that outlasts the retries is a refusal (never created)", async () => {
      fake.broadcasts.create.mockResolvedValue({ data: null, error: { statusCode: 429, name: "rate_limit_exceeded", message: "Too many requests" } })
      expect(await caught()).toBeInstanceOf(BroadcastRefusedError)
      expect(fake.broadcasts.create).toHaveBeenCalledTimes(4)
    })

    it.each([
      ["a null status code", { data: null, error: { statusCode: null, name: "application_error", message: "Unable to fetch data." } }, "Unable to fetch data."],
      ["a 503", { data: null, error: { statusCode: 503, name: "internal_server_error", message: "Service unavailable" } }, "Service unavailable"],
      ["a 500", { data: null, error: { statusCode: 500, name: "internal_server_error", message: "boom" } }, "boom"],
      ["no data and no error", { data: null, error: null }, null],
    ])("%s is unconfirmed and is not retried", async (_label, result, detail) => {
      fake.broadcasts.create.mockResolvedValue(result)
      const e = await caught()
      expect(e).toBeInstanceOf(BroadcastUnconfirmedError)
      expect(e).not.toBeInstanceOf(BroadcastRefusedError)
      expect((e as Error).message).toMatch(/^Resend did not confirm the send \(.+\)$/)
      if (detail) expect((e as Error).message).toBe(`Resend did not confirm the send (${detail})`)
      expect(fake.broadcasts.create).toHaveBeenCalledTimes(1)
    })

    it("an SDK throw is unconfirmed and keeps the original message", async () => {
      fake.broadcasts.create.mockRejectedValue(new Error("socket hang up"))
      const e = await caught()
      expect(e).toBeInstanceOf(BroadcastUnconfirmedError)
      expect((e as Error).message).toBe("Resend did not confirm the send (socket hang up)")
      expect(fake.broadcasts.create).toHaveBeenCalledTimes(1)
    })

    it("returns the broadcast id and passes previewText only when non-empty", async () => {
      fake.broadcasts.create.mockResolvedValue({ data: { id: "b_1" }, error: null })
      expect(await r.createAndSendBroadcast({ segmentId: "s", subject: "x", html: "h", name: "n", previewText: "peek" })).toEqual({ id: "b_1" })
      expect(fake.broadcasts.create).toHaveBeenLastCalledWith(expect.objectContaining({ previewText: "peek" }))
      await r.createAndSendBroadcast({ segmentId: "s", subject: "x", html: "h", name: "n", previewText: "" })
      expect(fake.broadcasts.create.mock.calls[1][0]).not.toHaveProperty("previewText")
    })

    it("sendTest prefixes the subject and throws on error", async () => {
      fake.emails.send.mockResolvedValue({ data: { id: "e" }, error: null })
      await r.sendTest({ to: "a@x.mu", subject: "Hi", html: "<p/>" })
      expect(fake.emails.send).toHaveBeenCalledWith({
        from: config.from,
        to: ["a@x.mu"],
        replyTo: config.replyTo,
        subject: "[TEST] Hi",
        html: "<p/>",
      })
      fake.emails.send.mockResolvedValue({ data: null, error: { statusCode: 500, name: "x", message: "smtp down" } })
      await expect(r.sendTest({ to: "a@x.mu", subject: "Hi", html: "<p/>" })).rejects.toThrow("smtp down")
    })
  })

  describe("config", () => {
    it("requires an API key and from email", () => {
      expect(() => getNewsletterConfig({})).toThrow(/RESEND_NEWSLETTER_API_KEY|RESEND_API_KEY/)
      expect(() => getNewsletterConfig({ RESEND_API_KEY: "k" })).toThrow(/RESEND_FROM_EMAIL/)
    })

    it("reads key, defaults and segments", () => {
      const c = getNewsletterConfig({
        RESEND_API_KEY: "k",
        RESEND_FROM_EMAIL: "hello@dollupboutique.com",
        RESEND_NEWSLETTER_SEGMENT_MAIN: "sm",
        RESEND_NEWSLETTER_SEGMENT_AFTER_DARK: "",
      })
      expect(c).toEqual({
        apiKey: "k",
        from: "Doll Up Team <hello@dollupboutique.com>",
        replyTo: "hello@dollupboutique.com",
        segments: { main: "sm", after_dark: null },
        storefrontUrl: "https://dollupboutique.com",
      })
    })

    it("prefers the newsletter key and honours overrides", () => {
      const c = getNewsletterConfig({
        RESEND_API_KEY: "old",
        RESEND_NEWSLETTER_API_KEY: "pro",
        RESEND_FROM_EMAIL: "h@d.com",
        RESEND_FROM_NAME: "Me",
        RESEND_REPLY_TO: "r@d.com",
        STOREFRONT_URL: "https://s.test",
      })
      expect(c.apiKey).toBe("pro")
      expect(c.from).toBe("Me <h@d.com>")
      expect(c.replyTo).toBe("r@d.com")
      expect(c.storefrontUrl).toBe("https://s.test")
    })

    it("strips trailing slashes from STOREFRONT_URL", () => {
      const base = { RESEND_API_KEY: "k", RESEND_FROM_EMAIL: "h@d.com" }
      expect(getNewsletterConfig({ ...base, STOREFRONT_URL: "https://dollupboutique.com/" }).storefrontUrl).toBe("https://dollupboutique.com")
      expect(getNewsletterConfig({ ...base, STOREFRONT_URL: "https://dollupboutique.com///" }).storefrontUrl).toBe("https://dollupboutique.com")
      expect(getNewsletterConfig({ ...base, STOREFRONT_URL: "/" }).storefrontUrl).toBe("https://dollupboutique.com")
    })

    it("rejects the same segment id for both lists", () => {
      const env = {
        RESEND_API_KEY: "k",
        RESEND_FROM_EMAIL: "h@d.com",
        RESEND_NEWSLETTER_SEGMENT_MAIN: "seg_same",
        RESEND_NEWSLETTER_SEGMENT_AFTER_DARK: "seg_same",
      }
      let err: unknown
      try {
        getNewsletterConfig(env)
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(MedusaError)
      expect((err as MedusaError).type).toBe(MedusaError.Types.INVALID_DATA)
      expect((err as Error).message).toBe(
        "RESEND_NEWSLETTER_SEGMENT_MAIN and RESEND_NEWSLETTER_SEGMENT_AFTER_DARK must be different segments"
      )
      expect(getNewsletterConfig({ ...env, RESEND_NEWSLETTER_SEGMENT_AFTER_DARK: "seg_ad" }).segments).toEqual({
        main: "seg_same",
        after_dark: "seg_ad",
      })
    })

    it("requireSegment throws naming the env var", () => {
      expect(requireSegment(config, "main")).toBe("seg_main")
      expect(() => requireSegment(config, "after_dark")).toThrow("RESEND_NEWSLETTER_SEGMENT_AFTER_DARK is not set")
    })
  })
})
