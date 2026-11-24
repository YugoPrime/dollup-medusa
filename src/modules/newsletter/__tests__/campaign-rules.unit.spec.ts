import { assertEditable, assertSendable, parseCampaignPatch } from "../campaign-rules"
import type { CampaignDTO } from "../types"

const campaign = (o: Partial<CampaignDTO> = {}): CampaignDTO => ({
  id: "nlcamp_1",
  list: "main",
  subject: "New arrivals",
  preheader: null,
  intro_text: null,
  banner_url: null,
  banner_link: null,
  product_ids: ["a"],
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

describe("parseCampaignPatch", () => {
  it("rejects a subject over 150 chars", () => {
    expect(() => parseCampaignPatch({ subject: "x".repeat(151) })).toThrow()
  })

  it("rejects duplicate product ids", () => {
    expect(() => parseCampaignPatch({ product_ids: ["a", "a"] })).toThrow()
  })

  it("rejects more than 24 products", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `p${i}`)
    expect(() => parseCampaignPatch({ product_ids: ids })).toThrow()
  })

  it("rejects a non-jpg/png or non-https banner", () => {
    expect(() =>
      parseCampaignPatch({ banner_url: "https://cdn.dollupboutique.com/newsletter/b.webp" })
    ).toThrow()
    expect(() =>
      parseCampaignPatch({ banner_url: "http://cdn.dollupboutique.com/newsletter/b.jpg" })
    ).toThrow()
    expect(parseCampaignPatch({ banner_url: "https://cdn.dollupboutique.com/n/b.JPG" })).toEqual({
      banner_url: "https://cdn.dollupboutique.com/n/b.JPG",
    })
  })

  it("accepts an https banner_link and nulls an empty one", () => {
    expect(parseCampaignPatch({ banner_link: " https://dollupboutique.com/sale " })).toEqual({
      banner_link: "https://dollupboutique.com/sale",
    })
    expect(parseCampaignPatch({ banner_link: "  " })).toEqual({ banner_link: null })
    expect(parseCampaignPatch({ banner_link: null })).toEqual({ banner_link: null })
  })

  it("rejects a banner_link that is not https, has spaces, is too long or not a string", () => {
    expect(() => parseCampaignPatch({ banner_link: "http://dollupboutique.com/sale" })).toThrow("banner_link")
    expect(() => parseCampaignPatch({ banner_link: "javascript:alert(1)" })).toThrow("banner_link")
    expect(() => parseCampaignPatch({ banner_link: "https://x.com/a b" })).toThrow("banner_link")
    expect(() => parseCampaignPatch({ banner_link: "https://x.com/" + "a".repeat(2000) })).toThrow("banner_link")
    expect(() => parseCampaignPatch({ banner_link: 5 })).toThrow("banner_link")
  })

  it("rejects an unknown list", () => {
    expect(() => parseCampaignPatch({ list: "vip" })).toThrow()
  })

  it("trims and keeps only known keys", () => {
    expect(parseCampaignPatch({ list: "after_dark", subject: " Hi ", nope: 1 })).toEqual({
      list: "after_dark",
      subject: "Hi",
    })
  })

  it("turns empty optional strings into null and allows an empty subject", () => {
    expect(
      parseCampaignPatch({ preheader: "  ", intro_text: "", banner_url: " ", subject: "" })
    ).toEqual({ preheader: null, intro_text: null, banner_url: null, subject: "" })
  })
})

describe("assertSendable", () => {
  it("throws for sending, sent, and failed with a broadcast id", () => {
    expect(() => assertSendable(campaign({ status: "sending" }))).toThrow(/already sent or sending/)
    expect(() => assertSendable(campaign({ status: "sent" }))).toThrow(/already sent or sending/)
    expect(() =>
      assertSendable(campaign({ status: "failed", resend_broadcast_id: "bc_1" }))
    ).toThrow(/already sent or sending/)
  })

  it("passes for failed without a broadcast id and for a draft with a subject", () => {
    expect(() => assertSendable(campaign({ status: "failed" }))).not.toThrow()
    expect(() => assertSendable(campaign())).not.toThrow()
  })

  it("throws when the subject is empty", () => {
    expect(() => assertSendable(campaign({ subject: "  " }))).toThrow(/subject is required/)
  })
})

describe("assertEditable", () => {
  it("allows draft and failed without a broadcast id", () => {
    expect(() => assertEditable(campaign())).not.toThrow()
    expect(() => assertEditable(campaign({ status: "failed" }))).not.toThrow()
  })

  it("blocks sending, sent, and failed with a broadcast id", () => {
    expect(() => assertEditable(campaign({ status: "sending" }))).toThrow(/only draft/)
    expect(() => assertEditable(campaign({ status: "sent" }))).toThrow(/only draft/)
    expect(() =>
      assertEditable(campaign({ status: "failed", resend_broadcast_id: "bc_1" }))
    ).toThrow(/only draft/)
  })
})
