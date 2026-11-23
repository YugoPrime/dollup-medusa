import NewsletterModuleService from "../service"
import type { SubscriberDTO } from "../types"

// The hand-written methods only call the generated CRUD methods on `this`, so they can be
// exercised against a fake `this` without a database.
const proto = NewsletterModuleService.prototype

describe("NewsletterModuleService.unsubscribedEmails", () => {
  it("returns the normalised, de-duplicated emails of unsubscribed rows on the list", async () => {
    const fake = {
      listNewsletterSubscribers: jest.fn(async () => [
        { email: "A@x.mu" },
        { email: "a@x.mu" },
        { email: "b@x.mu" },
        { email: "broken" },
      ]),
    }
    expect(await proto.unsubscribedEmails.call(fake, "main")).toEqual(["a@x.mu", "b@x.mu"])
    expect(fake.listNewsletterSubscribers).toHaveBeenCalledWith(
      { list: "main", status: "unsubscribed" },
      { select: ["email"], take: null }
    )
  })
})

describe("NewsletterModuleService.markUnsubscribed", () => {
  const row = (o: Partial<SubscriberDTO>) =>
    ({ id: "nlsub_1", email: "a@x.mu", list: "main", status: "subscribed", unsubscribed_at: null, ...o }) as SubscriberDTO

  it("flips a subscribed row and stamps unsubscribed_at", async () => {
    const fake = {
      retrieveNewsletterSubscriber: jest.fn(async () => row({})),
      updateNewsletterSubscribers: jest.fn(async (p: object) => ({ ...row({}), ...p })),
    }
    const out = await proto.markUnsubscribed.call(fake, "nlsub_1")
    expect(fake.updateNewsletterSubscribers).toHaveBeenCalledWith({
      id: "nlsub_1",
      status: "unsubscribed",
      unsubscribed_at: expect.any(Date),
    })
    expect(out.status).toBe("unsubscribed")
  })

  it("leaves an already-unsubscribed row (and its unsubscribed_at) alone", async () => {
    const when = new Date("2026-11-01T10:00:00Z")
    const fake = {
      retrieveNewsletterSubscriber: jest.fn(async () => row({ status: "unsubscribed", unsubscribed_at: when })),
      updateNewsletterSubscribers: jest.fn(),
    }
    const out = await proto.markUnsubscribed.call(fake, "nlsub_1")
    expect(fake.updateNewsletterSubscribers).not.toHaveBeenCalled()
    expect(out.unsubscribed_at).toBe(when)
  })
})
