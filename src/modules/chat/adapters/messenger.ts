import type { ChannelAdapter, SendCtx, SendResult } from "./types"

const MESSENGER_24H_MS = 24 * 60 * 60 * 1000
const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? "v20.0"}`

export const messengerAdapter: ChannelAdapter = {
  channel: "messenger",
  requiresAccount: true,

  replyWindowEndsAt(thread) {
    if (!thread.last_inbound_at) return null
    return new Date(new Date(thread.last_inbound_at).getTime() + MESSENGER_24H_MS)
  },

  // Mirrors service.ts's sendOutboundMessenger's Graph API call verbatim:
  // same endpoint, same request body shape, same messaging_type/tag logic,
  // same error-string format. NOTE (see task-0.2-report.md): the existing
  // method does not decrypt ChannelAccount.access_token_enc at all — it
  // reads the page token straight from process.env.META_PAGE_ACCESS_TOKEN.
  // ctx.accessTokenEnc is intentionally unused here to reproduce that real
  // (if surprising) mechanism rather than inventing a decryption scheme.
  async sendText(ctx: SendCtx, body: string): Promise<SendResult> {
    const text = body?.trim()
    if (!text) {
      return { ok: false, error: "Cannot send empty message" }
    }

    const accessToken = process.env.META_PAGE_ACCESS_TOKEN
    if (!accessToken) {
      return { ok: false, error: "META_PAGE_ACCESS_TOKEN not configured" }
    }

    const url = `${GRAPH}/me/messages?access_token=${encodeURIComponent(accessToken)}`
    const requestBody: Record<string, unknown> = {
      recipient: { id: ctx.recipientExternalId },
      message: { text },
      messaging_type: ctx.outsideReplyWindow ? "MESSAGE_TAG" : "RESPONSE",
    }
    if (ctx.outsideReplyWindow) {
      requestBody.tag = "HUMAN_AGENT"
    }

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      })
      const json = (await resp.json().catch(() => ({}))) as {
        message_id?: string
        error?: { message?: string; code?: number; type?: string }
      }
      if (!resp.ok || json.error) {
        return {
          ok: false,
          error:
            json.error?.message ||
            `Meta send failed (${resp.status} ${resp.statusText})`,
        }
      }
      return { ok: true, external_id: json.message_id ?? null }
    } catch (err) {
      return { ok: false, error: (err as Error).message || "network error" }
    }
  },
}
