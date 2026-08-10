import type { ChannelAdapter, ChatChannel } from "./types"
import { messengerAdapter } from "./messenger"
import { webAdapter } from "./web"

export type { ChannelAdapter, ChatChannel, SendCtx, SendResult, ThreadLike } from "./types"

const ADAPTERS: Partial<Record<ChatChannel, ChannelAdapter>> = {
  messenger: messengerAdapter,
  web: webAdapter,
  // instagram: sub-project 2. whatsapp: sub-project 3.
}

export function resolveAdapter(channel: string): ChannelAdapter {
  const adapter = ADAPTERS[channel as ChatChannel]
  if (!adapter) {
    throw new Error(`chat: no adapter registered for channel "${channel}"`)
  }
  return adapter
}
