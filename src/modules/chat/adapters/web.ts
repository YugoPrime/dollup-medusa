import type { ChannelAdapter } from "./types"

export const webAdapter: ChannelAdapter = {
  channel: "web",
  // The widget authenticates by session id, not by a business account token.
  requiresAccount: false,
  // The widget polls whenever it is open; there is no engagement window to respect.
  replyWindowEndsAt: () => null,
  // No external call: sendOutbound has already written the message row, and the
  // browser picks it up on its next poll. Returning ok with a null external_id
  // keeps the message at meta_status "sent" rather than "pending".
  async sendText() {
    return { ok: true, external_id: null }
  },
}
