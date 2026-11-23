import { MedusaError } from "@medusajs/framework/utils"

import { MAX_PRODUCTS } from "./lib/catalogue"
import { NEWSLETTER_LISTS, type CampaignDTO, type NewsletterList } from "./types"

export type CampaignPatch = Partial<
  Pick<CampaignDTO, "list" | "subject" | "preheader" | "intro_text" | "banner_url" | "product_ids">
>

const BANNER_RE = /^https:\/\/\S+\.(jpe?g|png)$/i

const invalid = (msg: string) => new MedusaError(MedusaError.Types.INVALID_DATA, msg)

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw invalid(`${field} must be a string`)
  const v = value.trim()
  if (v.length > max) throw invalid(`${field} must be at most ${max} characters`)
  return v
}

export function parseCampaignPatch(body: unknown): CampaignPatch {
  if (!body || typeof body !== "object") throw invalid("body must be an object")
  const b = body as Record<string, unknown>
  const out: CampaignPatch = {}

  if ("list" in b) {
    if (typeof b.list !== "string" || !NEWSLETTER_LISTS.includes(b.list as NewsletterList)) {
      throw invalid("list must be main or after_dark")
    }
    out.list = b.list as NewsletterList
  }
  if ("subject" in b) out.subject = text(b.subject, "subject", 150)
  if ("preheader" in b) {
    out.preheader = b.preheader === null ? null : text(b.preheader, "preheader", 150) || null
  }
  if ("intro_text" in b) {
    out.intro_text = b.intro_text === null ? null : text(b.intro_text, "intro_text", 2000) || null
  }
  if ("banner_url" in b) {
    if (b.banner_url === null) out.banner_url = null
    else {
      const v = text(b.banner_url, "banner_url", 2000)
      if (v !== "" && !BANNER_RE.test(v)) {
        throw invalid("banner_url must be an https .jpg, .jpeg or .png URL")
      }
      out.banner_url = v || null
    }
  }
  if ("product_ids" in b) {
    const ids = b.product_ids
    if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string" || !i)) {
      throw invalid("product_ids must be an array of strings")
    }
    if (new Set(ids).size !== ids.length) throw invalid("product_ids must be unique")
    if (ids.length > MAX_PRODUCTS) throw invalid(`at most ${MAX_PRODUCTS} products per campaign`)
    out.product_ids = ids as string[]
  }
  return out
}

const isOpenState = (c: CampaignDTO) =>
  c.status === "draft" || (c.status === "failed" && c.resend_broadcast_id === null)

export function assertSendable(c: CampaignDTO): void {
  if (!isOpenState(c)) {
    throw new MedusaError(MedusaError.Types.CONFLICT, "Campaign was already sent or sending")
  }
  if (!c.subject.trim()) throw invalid("subject is required")
}

export function assertEditable(c: CampaignDTO): void {
  if (!isOpenState(c)) {
    throw new MedusaError(MedusaError.Types.CONFLICT, "only draft campaigns can be edited")
  }
}
