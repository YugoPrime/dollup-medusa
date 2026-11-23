import {
  previewCampaign,
  sendCampaign,
  sendTestCampaign,
  type CampaignDeps,
} from "../send-campaign"
import type { CatalogueProduct } from "../lib/catalogue"
import type { CampaignDTO, SubscriberDTO } from "../types"

const prod = (o: Partial<CatalogueProduct> = {}): CatalogueProduct => ({
  id: "p",
  title: "Satin Dress",
  handle: "satin-dress",
  status: "published",
  thumbnail: "https://cdn.dollupboutique.com/a.webp",
  images: [{ url: "https://cdn.dollupboutique.com/a.jpg" }],
  categories: [{ handle: "dresses" }],
  metadata: null,
  variants: [
    {
      manage_inventory: false,
      calculated_price: { calculated_amount: 1290, original_amount: 1290 },
    },
  ],
  ...o,
})

const baseCampaign = (o: Partial<CampaignDTO> = {}): CampaignDTO => ({
  id: "nlcamp_1",
  list: "main",
  subject: "New arrivals",
  preheader: "Fresh in",
  intro_text: null,
  banner_url: null,
  product_ids: ["a", "b"],
  status: "draft",
  resend_broadcast_id: null,
  recipient_count: null,
  sent_at: null,
  sent_by: null,
  error: null,
  created_at: new Date(),
  updated_at: new Date(),
  ...o,
})

const sub = (id: string, email: string): SubscriberDTO =>
  ({ id, email, list: "main", status: "subscribed" }) as SubscriberDTO

function setup(opts: { unsynced?: SubscriberDTO[]; totalMain?: number; segmentMain?: string | null } = {}) {
  const callOrder: string[] = []
  const store = { campaign: baseCampaign() }
  const unsynced = opts.unsynced ?? [sub("s1", "new@x.mu")]

  const service = {
    retrieveNewsletterCampaign: jest.fn(async () => ({ ...store.campaign })),
    updateNewsletterCampaigns: jest.fn(async (patch: Partial<CampaignDTO> & { id: string }) => {
      store.campaign = { ...store.campaign, ...patch }
      return { ...store.campaign }
    }),
    listUnsynced: jest.fn(async () => unsynced),
    markSynced: jest.fn(async () => undefined),
    markSyncError: jest.fn(async () => undefined),
    markUnsubscribedByEmails: jest.fn(async () => {
      callOrder.push("markUnsubscribedByEmails")
      return 1
    }),
    subscribedTotals: jest.fn(async () => {
      callOrder.push("subscribedTotals")
      return { main: opts.totalMain ?? 2, after_dark: 0, contacts: 2 }
    }),
  }

  const resend = {
    ensureContact: jest.fn(async (): Promise<any> => {
      callOrder.push("ensureContact")
      return { ok: true, contactId: "ct_1" }
    }),
    listUnsubscribedEmails: jest.fn(async (): Promise<string[]> => {
      callOrder.push("listUnsubscribedEmails")
      return []
    }),
    setUnsubscribed: jest.fn(),
    resubscribe: jest.fn(),
    createAndSendBroadcast: jest.fn(async (): Promise<{ id: string }> => {
      callOrder.push("createAndSendBroadcast")
      return { id: "bc_1" }
    }),
    sendTest: jest.fn(async () => undefined),
  }

  const loadProducts = jest.fn(async () => [prod({ id: "a" }), prod({ id: "b" })])
  const render = jest.fn(async (i: { cards: unknown[] }) => "<html>" + i.cards.length)

  let chain: Promise<unknown> = Promise.resolve()
  const withLock = jest.fn(<T,>(_key: string, fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn)
    chain = run.catch(() => undefined)
    return run
  })

  const config = {
    apiKey: "k",
    from: "Doll Up Team <hello@dollupboutique.com>",
    replyTo: "hello@dollupboutique.com",
    segments: { main: opts.segmentMain === undefined ? "seg_main" : opts.segmentMain, after_dark: "seg_ad" },
    storefrontUrl: "https://dollupboutique.com",
  }

  const deps = { service, resend, config, loadProducts, render, withLock } as unknown as CampaignDeps
  return { deps, service, resend, loadProducts, render, withLock, store, callOrder }
}

describe("sendCampaign", () => {
  it("pulls unsubscribes before counting and only syncs unsynced rows as subscribed", async () => {
    const t = setup()
    t.resend.listUnsubscribedEmails.mockImplementationOnce(async () => {
      t.callOrder.push("listUnsubscribedEmails")
      return ["gone@x.mu"]
    })
    await sendCampaign(t.deps, "nlcamp_1", "rahvi")
    expect(t.service.markUnsubscribedByEmails).toHaveBeenCalledWith("main", ["gone@x.mu"])
    expect(t.callOrder).toEqual([
      "listUnsubscribedEmails",
      "markUnsubscribedByEmails",
      "ensureContact",
      "subscribedTotals",
      "createAndSendBroadcast",
    ])
    expect(t.resend.ensureContact).toHaveBeenCalledTimes(1)
    expect(t.resend.ensureContact).toHaveBeenCalledWith("new@x.mu", "seg_main", false)
    expect(t.resend.resubscribe).not.toHaveBeenCalled()
    expect(t.service.markSynced).toHaveBeenCalledWith("s1", "ct_1")
  })

  it("creates exactly one broadcast when sent twice at once", async () => {
    const t = setup()
    const [a, b] = await Promise.allSettled([
      sendCampaign(t.deps, "nlcamp_1", "u1"),
      sendCampaign(t.deps, "nlcamp_1", "u2"),
    ])
    expect(t.resend.createAndSendBroadcast).toHaveBeenCalledTimes(1)
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"])
    const rejected = [a, b].find((r) => r.status === "rejected") as PromiseRejectedResult
    expect(String(rejected.reason.message)).toMatch(/already sent or sending/)
  })

  it("uses fresh product data and the unsubscribe placeholder", async () => {
    const t = setup()
    t.loadProducts.mockResolvedValue([
      prod({ id: "a" }),
      prod({ id: "b", categories: [{ handle: "toys" }] }),
    ])
    const sent = await sendCampaign(t.deps, "nlcamp_1", "rahvi")
    const input = t.render.mock.calls[0][0] as any
    expect(input.cards.map((c: { id: string }) => c.id)).toEqual(["a"])
    expect(input.unsubscribeUrl).toBe("{{{RESEND_UNSUBSCRIBE_URL}}}")
    expect(sent).toMatchObject({
      status: "sent",
      sent_by: "rahvi",
      recipient_count: 2,
      resend_broadcast_id: "bc_1",
    })
    expect(t.resend.createAndSendBroadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        segmentId: "seg_main",
        subject: "New arrivals",
        name: "Doll Up nlcamp_1",
        previewText: "Fresh in",
        html: "<html>1",
      })
    )
  })

  it("subtracts sync failures from recipient_count", async () => {
    const t = setup({ unsynced: [sub("s1", "a@x.mu"), sub("s2", "b@x.mu")], totalMain: 3 })
    t.resend.ensureContact
      .mockResolvedValueOnce({ ok: true, contactId: "ct_1" })
      .mockResolvedValueOnce({ ok: false, error: "x" })
    const sent = await sendCampaign(t.deps, "nlcamp_1", "rahvi")
    expect(sent.recipient_count).toBe(2)
    expect(t.service.markSyncError).toHaveBeenCalledTimes(1)
    expect(t.service.markSyncError).toHaveBeenCalledWith("s2", "x")
  })

  describe("when Resend refuses", () => {
    it("marks failed (retryable) and a retry can succeed", async () => {
      const t = setup()
      t.resend.createAndSendBroadcast.mockRejectedValueOnce(new Error("You have reached your contacts quota."))
      await expect(sendCampaign(t.deps, "nlcamp_1", "rahvi")).rejects.toThrow(/quota/)
      expect(t.store.campaign).toMatchObject({
        status: "failed",
        error: expect.stringMatching(/quota/),
        resend_broadcast_id: null,
      })
      t.resend.createAndSendBroadcast.mockResolvedValueOnce({ id: "bc_2" })
      await sendCampaign(t.deps, "nlcamp_1", "rahvi")
      expect(t.store.campaign.status).toBe("sent")
      expect(t.store.campaign.resend_broadcast_id).toBe("bc_2")
    })

    it("keeps the broadcast id and never marks failed when the final update throws", async () => {
      const t = setup()
      t.resend.createAndSendBroadcast.mockResolvedValueOnce({ id: "bc_3" })
      const real = t.service.updateNewsletterCampaigns.getMockImplementation()!
      t.service.updateNewsletterCampaigns.mockImplementation(async (p) => {
        if (p.status === "sent") throw new Error("db down")
        return real(p)
      })
      await expect(sendCampaign(t.deps, "nlcamp_1", "rahvi")).rejects.toThrow(/was sent/)
      expect(t.store.campaign).toMatchObject({ status: "sending", resend_broadcast_id: "bc_3" })
      expect(t.store.campaign.error).toMatch(/db down/)
      await expect(sendCampaign(t.deps, "nlcamp_1", "rahvi")).rejects.toThrow(/already sent or sending/)
      expect(t.resend.createAndSendBroadcast).toHaveBeenCalledTimes(1)
    })

    it("never marks failed when the broadcast-id update itself throws once", async () => {
      const t = setup()
      t.resend.createAndSendBroadcast.mockResolvedValueOnce({ id: "bc_4" })
      const real = t.service.updateNewsletterCampaigns.getMockImplementation()!
      t.service.updateNewsletterCampaigns.mockImplementationOnce(real) // "sending"
      t.service.updateNewsletterCampaigns.mockImplementationOnce(async () => {
        throw new Error("blip")
      })
      await expect(sendCampaign(t.deps, "nlcamp_1", "rahvi")).rejects.toThrow(/was sent/)
      expect(t.store.campaign.status).toBe("sending")
      expect(t.store.campaign.resend_broadcast_id).toBe("bc_4")
    })
  })

  describe("guards", () => {
    it("reverts to draft with no cards left and creates no broadcast", async () => {
      const t = setup()
      t.loadProducts.mockResolvedValue([])
      await expect(sendCampaign(t.deps, "nlcamp_1", "rahvi")).rejects.toThrow(/no products left to send/)
      expect(t.store.campaign.status).toBe("draft")
      expect(t.resend.createAndSendBroadcast).not.toHaveBeenCalled()
    })

    it("reverts to draft when the list has no subscribers", async () => {
      const t = setup({ unsynced: [], totalMain: 0 })
      await expect(sendCampaign(t.deps, "nlcamp_1", "rahvi")).rejects.toThrow(/list has no subscribers/)
      expect(t.store.campaign.status).toBe("draft")
      expect(t.resend.createAndSendBroadcast).not.toHaveBeenCalled()
    })

    it("throws before changing status when the segment env is missing", async () => {
      const t = setup({ segmentMain: null })
      await expect(sendCampaign(t.deps, "nlcamp_1", "rahvi")).rejects.toThrow(/SEGMENT_MAIN/)
      expect(t.store.campaign.status).toBe("draft")
      expect(t.service.updateNewsletterCampaigns).not.toHaveBeenCalled()
    })
  })
})

describe("previewCampaign", () => {
  it("returns recipient estimate and unsynced count without writes or Resend calls", async () => {
    const t = setup({ unsynced: [sub("s1", "a@x.mu"), sub("s2", "b@x.mu")], totalMain: 5 })
    const p = await previewCampaign(t.deps, "nlcamp_1")
    expect(p).toMatchObject({ html: "<html>2", cardCount: 2, recipientEstimate: 5, unsyncedCount: 2 })
    expect((t.render.mock.calls[0][0] as any).unsubscribeUrl).toBe("#")
    expect(t.service.updateNewsletterCampaigns).not.toHaveBeenCalled()
    expect(t.resend.listUnsubscribedEmails).not.toHaveBeenCalled()
    expect(t.resend.ensureContact).not.toHaveBeenCalled()
  })
})

describe("sendTestCampaign", () => {
  it("sends a test with # as the unsubscribe url", async () => {
    const t = setup()
    await sendTestCampaign(t.deps, "nlcamp_1", " Me@X.mu ")
    expect(t.resend.sendTest).toHaveBeenCalledWith({ to: "me@x.mu", subject: "New arrivals", html: "<html>2" })
    expect((t.render.mock.calls[0][0] as any).unsubscribeUrl).toBe("#")
    expect(t.service.updateNewsletterCampaigns).not.toHaveBeenCalled()
  })

  it("rejects a bad address, an empty subject and zero cards", async () => {
    const t = setup()
    await expect(sendTestCampaign(t.deps, "nlcamp_1", "nope")).rejects.toThrow(/valid email/)
    t.store.campaign.subject = ""
    await expect(sendTestCampaign(t.deps, "nlcamp_1", "me@x.mu")).rejects.toThrow(/subject is required/)
    t.store.campaign.subject = "Hi"
    t.loadProducts.mockResolvedValue([])
    await expect(sendTestCampaign(t.deps, "nlcamp_1", "me@x.mu")).rejects.toThrow(/no products left/)
    expect(t.resend.sendTest).not.toHaveBeenCalled()
  })
})
