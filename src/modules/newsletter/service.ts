/* eslint-disable @typescript-eslint/no-explicit-any */
import { MedusaError, MedusaService } from "@medusajs/framework/utils"

import { normalizeEmail } from "./lib/email"
import { decideAdd, decideImport } from "./lib/subscriber-rules"
import NewsletterCampaign from "./models/campaign"
import NewsletterSubscriber from "./models/subscriber"
import type {
  CampaignDTO,
  NewsletterList,
  SubscriberDTO,
  SubscriberSource,
  SubscriberStatus,
} from "./types"

class NewsletterModuleService extends MedusaService({
  NewsletterSubscriber,
  NewsletterCampaign,
}) {
  private async findSubscriber(
    email: string,
    list: NewsletterList
  ): Promise<SubscriberDTO | null> {
    const svc = this as any
    const rows = (await svc.listNewsletterSubscribers(
      { email, list },
      { take: 1 }
    )) as SubscriberDTO[]
    return rows[0] ?? null
  }

  async addSubscriber(input: {
    email: string
    list: NewsletterList
    source: SubscriberSource
  }): Promise<{
    subscriber: SubscriberDTO
    outcome: "created" | "already_subscribed" | "resubscribed"
  }> {
    const email = normalizeEmail(input.email)
    if (!email) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Invalid email address"
      )
    }
    const svc = this as any
    const existing = await this.findSubscriber(email, input.list)
    const decision = decideAdd(existing, input.source)

    if (decision === "create") {
      const subscriber = (await svc.createNewsletterSubscribers({
        email,
        list: input.list,
        source: input.source,
        status: "subscribed",
        subscribed_at: new Date(),
      })) as SubscriberDTO
      return { subscriber, outcome: "created" }
    }
    if (decision === "resubscribe") {
      const subscriber = (await svc.updateNewsletterSubscribers({
        id: existing!.id,
        status: "subscribed",
        subscribed_at: new Date(),
        unsubscribed_at: null,
      })) as SubscriberDTO
      return { subscriber, outcome: "resubscribed" }
    }
    return { subscriber: existing!, outcome: "already_subscribed" }
  }

  async importSubscribers(
    list: NewsletterList,
    rows: Array<{ email: string; unsubscribed: boolean }>
  ): Promise<{ added: SubscriberDTO[]; skipped: number }> {
    const svc = this as any
    const added: SubscriberDTO[] = []
    let skipped = 0
    for (const row of rows) {
      const email = normalizeEmail(row.email)
      if (!email) {
        skipped++
        continue
      }
      const existing = await this.findSubscriber(email, list)
      const decision = decideImport(existing, row.unsubscribed)
      if (decision === "create") {
        const now = new Date()
        const created = (await svc.createNewsletterSubscribers({
          email,
          list,
          source: "import",
          status: row.unsubscribed ? "unsubscribed" : "subscribed",
          subscribed_at: now,
          unsubscribed_at: row.unsubscribed ? now : null,
        })) as SubscriberDTO
        added.push(created)
      } else if (decision === "unsubscribe") {
        await svc.updateNewsletterSubscribers({
          id: existing!.id,
          status: "unsubscribed",
          unsubscribed_at: new Date(),
        })
        skipped++
      } else {
        skipped++
      }
    }
    return { added, skipped }
  }

  async listSubscribersPage(f: {
    list: NewsletterList
    status?: SubscriberStatus
    q?: string
    limit: number
    offset: number
  }): Promise<{ subscribers: SubscriberDTO[]; count: number }> {
    const svc = this as any
    const filters: Record<string, unknown> = { list: f.list }
    if (f.status) filters.status = f.status
    const q = f.q?.trim()
    if (q) {
      filters.email = { $ilike: `%${q}%` }
    }
    const [subscribers, count] = (await svc.listAndCountNewsletterSubscribers(
      filters,
      { take: f.limit, skip: f.offset, order: { subscribed_at: "DESC" } }
    )) as [SubscriberDTO[], number]
    return { subscribers, count }
  }

  async subscribedTotals(): Promise<{
    main: number
    after_dark: number
    contacts: number
  }> {
    const svc = this as any
    const rows = (await svc.listNewsletterSubscribers(
      { status: "subscribed" },
      { select: ["email", "list"], take: null }
    )) as Array<Pick<SubscriberDTO, "email" | "list">>
    let main = 0
    let afterDark = 0
    const distinct = new Set<string>()
    for (const r of rows) {
      if (r.list === "main") main++
      else if (r.list === "after_dark") afterDark++
      distinct.add(r.email)
    }
    return { main, after_dark: afterDark, contacts: distinct.size }
  }

  async listUnsynced(list: NewsletterList): Promise<SubscriberDTO[]> {
    const svc = this as any
    return (await svc.listNewsletterSubscribers(
      { list, status: "subscribed", resend_synced_at: null },
      { take: null }
    )) as SubscriberDTO[]
  }

  async markSynced(id: string, contactId: string | null): Promise<void> {
    const svc = this as any
    const patch: Record<string, unknown> = {
      id,
      resend_synced_at: new Date(),
      resend_sync_error: null,
    }
    if (contactId !== null) patch.resend_contact_id = contactId
    await svc.updateNewsletterSubscribers(patch)
  }

  async markSyncError(id: string, message: string): Promise<void> {
    const svc = this as any
    await svc.updateNewsletterSubscribers({
      id,
      resend_sync_error: message.slice(0, 500),
    })
  }

  async markUnsubscribed(id: string): Promise<SubscriberDTO> {
    const svc = this as any
    return (await svc.updateNewsletterSubscribers({
      id,
      status: "unsubscribed",
      unsubscribed_at: new Date(),
    })) as SubscriberDTO
  }

  async markUnsubscribedByEmails(
    list: NewsletterList,
    emails: string[]
  ): Promise<number> {
    const normalized = [
      ...new Set(
        emails.map((e) => normalizeEmail(e)).filter((e): e is string => !!e)
      ),
    ]
    if (normalized.length === 0) return 0
    const svc = this as any
    const rows = (await svc.listNewsletterSubscribers(
      { list, status: "subscribed", email: normalized },
      { select: ["id"], take: null }
    )) as Array<{ id: string }>
    if (rows.length === 0) return 0
    const now = new Date()
    await svc.updateNewsletterSubscribers(
      rows.map((r) => ({
        id: r.id,
        status: "unsubscribed",
        unsubscribed_at: now,
      }))
    )
    return rows.length
  }

  async createDraft(list: NewsletterList): Promise<CampaignDTO> {
    const svc = this as any
    return (await svc.createNewsletterCampaigns({
      list,
      subject: "",
      product_ids: [],
      status: "draft",
    })) as CampaignDTO
  }

  async listCampaigns(): Promise<CampaignDTO[]> {
    const svc = this as any
    return (await svc.listNewsletterCampaigns(
      {},
      { order: { created_at: "DESC" }, take: null }
    )) as CampaignDTO[]
  }
}

export default NewsletterModuleService
