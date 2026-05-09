import { MedusaService } from "@medusajs/framework/utils"
import { ChannelAccount } from "./models/channel-account"
import { Contact } from "./models/contact"
import { Thread } from "./models/thread"
import { Message } from "./models/message"

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

    // 4. Insert message
    const attachments =
      input.attachments && input.attachments.length > 0
        ? input.attachments
        : null
    const message = await this.createMessages({
      thread_id: (thread as any).id,
      direction: "inbound",
      external_id: input.messageId,
      sender_kind: "customer",
      body: input.text,
      attachments,
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
}

export default ChatModuleService
