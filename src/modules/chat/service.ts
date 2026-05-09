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
}

export default ChatModuleService
