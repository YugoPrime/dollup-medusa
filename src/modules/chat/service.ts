import { MedusaService } from "@medusajs/framework/utils"
import { ChannelAccount } from "./models/channel-account"
import { Contact } from "./models/contact"
import { Thread } from "./models/thread"
import { Message } from "./models/message"

const MESSENGER_24H_MS = 24 * 60 * 60 * 1000

class ChatModuleService extends MedusaService({
  ChannelAccount,
  Contact,
  Thread,
  Message,
}) {
  async findOrCreateContact(input: {
    channel: "whatsapp" | "messenger" | "instagram"
    external_id: string
    display_name?: string | null
    profile_pic_url?: string | null
    metadata?: Record<string, unknown> | null
  }) {
    const [existing] = await this.listContacts({
      channel: input.channel,
      external_id: input.external_id,
    })
    if (existing) {
      if (input.display_name && existing.display_name !== input.display_name) {
        const updated = await this.updateContacts({
          id: existing.id,
          display_name: input.display_name,
          profile_pic_url: input.profile_pic_url ?? existing.profile_pic_url,
          metadata: input.metadata ?? existing.metadata,
          last_seen_at: new Date(),
        } as unknown as Parameters<this["updateContacts"]>[0])
        return updated
      }
      return existing
    }
    return await this.createContacts({
      channel: input.channel,
      external_id: input.external_id,
      display_name: input.display_name ?? null,
      profile_pic_url: input.profile_pic_url ?? null,
      link_status: "unknown",
      last_seen_at: new Date(),
      metadata: input.metadata ?? null,
    } as unknown as Parameters<this["createContacts"]>[0])
  }

  async ingestInboundMessenger(input: {
    pageId: string
    senderId: string
    messageId: string
    text: string | null
    attachments?: Array<{ type: string; url: string; mime?: string }>
    timestamp: number
    senderProfile?: { name?: string; profile_pic?: string }
  }): Promise<{ message: any; thread: any; contact: any }> {
    // 1. Idempotency check — must be first branch
    const [dup] = await this.listMessages({ external_id: input.messageId })
    if (dup) {
      const [dupThread] = await this.listThreads({ id: dup.thread_id })
      const [dupContact] = await this.listContacts({ id: dupThread.contact_id })
      return { message: dup, thread: dupThread, contact: dupContact }
    }

    // 2. Find or create contact
    const contact = (await this.findOrCreateContact({
      channel: "messenger",
      external_id: input.senderId,
      display_name: input.senderProfile?.name ?? null,
      profile_pic_url: input.senderProfile?.profile_pic ?? null,
    })) as any

    // 3. Find or create thread
    let [thread] = await this.listThreads({
      channel: "messenger",
      contact_id: contact.id,
    })
    if (!thread) {
      thread = (await this.createThreads({
        channel: "messenger",
        contact_id: contact.id,
        status: "open",
        unread_count: 0,
      } as unknown as Parameters<this["createThreads"]>[0])) as any
    }

    // 4. Rehost inbound image attachments to R2 (Meta URLs expire), then insert
    const rehosted: Array<{
      kind: "image"
      url_r2: string
      mime: string
      size: number
    }> = []
    if (input.attachments?.length) {
      const { rehostMetaAttachment } = await import(
        "./lib/rehost-meta-attachment.js"
      )
      for (const a of input.attachments) {
        const out = await rehostMetaAttachment(a, (thread as any).id)
        if (out) rehosted.push(out)
      }
    }
    const message = await this.createMessages({
      thread_id: (thread as any).id,
      direction: "inbound",
      external_id: input.messageId,
      sender_kind: "customer",
      body: input.text,
      attachments: rehosted.length > 0 ? rehosted : null,
      meta_status: "delivered",
    } as unknown as Parameters<this["createMessages"]>[0])

    // 5. Bump thread counters
    const tsDate = new Date(input.timestamp)
    thread = (await this.updateThreads({
      id: (thread as any).id,
      last_message_at: tsDate,
      last_inbound_at: tsDate,
      unread_count: ((thread as any).unread_count ?? 0) + 1,
    } as unknown as Parameters<this["updateThreads"]>[0])) as any

    return { message, thread, contact }
  }

  /**
   * Send an outbound text message on a Messenger thread.
   *
   * Calls Meta's Send API and writes one chat_message row regardless of
   * outcome. On success the row carries the Meta `mid` so future webhook
   * echoes (which we already filter out) line up. On failure the row's
   * meta_status is `failed` and meta_error holds the upstream message —
   * this lets the inbox UI render failed sends without a separate table.
   *
   * The 24h customer-engagement window is enforced here (not at the route)
   * so any caller — composer, scheduled sender, future AI agent — gets the
   * same gate. Pass `tag: "HUMAN_AGENT"` to send past 24h; Meta still
   * requires the page to be allowlisted for that tag in production.
   */
  async sendOutboundMessenger(input: {
    threadId: string
    text: string
    senderUserId?: string | null
    tag?: "HUMAN_AGENT" | null
  }): Promise<{ message: any; thread: any }> {
    const text = input.text?.trim()
    if (!text) {
      throw new Error("Cannot send empty message")
    }

    const [thread] = await this.listThreads({ id: input.threadId })
    if (!thread) {
      throw new Error(`Thread not found: ${input.threadId}`)
    }
    if (thread.channel !== "messenger") {
      throw new Error(
        `sendOutboundMessenger called on ${thread.channel} thread`
      )
    }
    const [contact] = await this.listContacts({ id: thread.contact_id })
    if (!contact) {
      throw new Error(`Contact not found for thread ${input.threadId}`)
    }

    // 24h gate — Meta rejects MESSAGE_TAG-less sends past the window
    const lastInbound = thread.last_inbound_at
      ? new Date(thread.last_inbound_at).getTime()
      : 0
    const outsideWindow = !lastInbound || Date.now() - lastInbound > MESSENGER_24H_MS
    if (outsideWindow && !input.tag) {
      throw new Error(
        "Outside 24h window — pass tag: 'HUMAN_AGENT' to send (page must be allowlisted)"
      )
    }

    const accessToken = process.env.META_PAGE_ACCESS_TOKEN
    const graphVersion = process.env.META_GRAPH_VERSION || "v20.0"
    if (!accessToken) {
      // Persist a failed row so the staff sees what happened in the UI
      const failed = await this.createMessages({
        thread_id: thread.id,
        direction: "outbound",
        external_id: null,
        sender_kind: "staff",
        sender_user_id: input.senderUserId ?? null,
        body: text,
        attachments: null,
        meta_status: "failed",
        meta_error: "META_PAGE_ACCESS_TOKEN not configured",
      } as unknown as Parameters<this["createMessages"]>[0])
      return { message: failed, thread }
    }

    const url = `https://graph.facebook.com/${graphVersion}/me/messages?access_token=${encodeURIComponent(
      accessToken
    )}`
    const body: Record<string, unknown> = {
      recipient: { id: contact.external_id },
      message: { text },
      messaging_type: input.tag ? "MESSAGE_TAG" : "RESPONSE",
    }
    if (input.tag) body.tag = input.tag

    let metaMid: string | null = null
    let metaError: string | null = null
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = (await resp.json().catch(() => ({}))) as {
        message_id?: string
        error?: { message?: string; code?: number; type?: string }
      }
      if (!resp.ok || json.error) {
        metaError =
          json.error?.message ||
          `Meta send failed (${resp.status} ${resp.statusText})`
      } else {
        metaMid = json.message_id ?? null
      }
    } catch (err) {
      metaError = (err as Error).message || "network error"
    }

    const now = new Date()
    const message = await this.createMessages({
      thread_id: thread.id,
      direction: "outbound",
      external_id: metaMid,
      sender_kind: "staff",
      sender_user_id: input.senderUserId ?? null,
      body: text,
      attachments: null,
      meta_status: metaError ? "failed" : "sent",
      meta_error: metaError,
    } as unknown as Parameters<this["createMessages"]>[0])

    // Bump last_message_at on success so the thread floats to the top of
    // the list. On failure leave it alone — a failed send shouldn't reorder.
    let updatedThread = thread
    if (!metaError) {
      updatedThread = (await this.updateThreads({
        id: thread.id,
        last_message_at: now,
      } as unknown as Parameters<this["updateThreads"]>[0])) as any
    }

    return { message, thread: updatedThread }
  }

  /**
   * Aggregate counts for the nav badge + dashboard tile. Cheap enough to
   * call on every nav render at v1 volume; revisit with a materialized
   * counter if it ever shows up in slow-query logs.
   */
  async getInboxSummary(): Promise<{
    unread_total: number
    open_count: number
  }> {
    const openThreads = await this.listThreads({ status: "open" })
    let unread = 0
    for (const t of openThreads) {
      unread += (t as any).unread_count ?? 0
    }
    return { unread_total: unread, open_count: openThreads.length }
  }
}

export default ChatModuleService
