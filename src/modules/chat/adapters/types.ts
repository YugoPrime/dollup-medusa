export type ChatChannel = "whatsapp" | "messenger" | "instagram" | "web"

export type SendResult =
  | { ok: true; external_id: string | null }
  | { ok: false; error: string }

/** Minimal thread shape an adapter needs — avoids importing the DML type. */
export type ThreadLike = { last_inbound_at?: Date | string | null }

export type SendCtx = {
  threadId: string
  /** Channel-specific recipient key: PSID, IGSID, E.164 phone, or web session id. */
  recipientExternalId: string
  /** True when the reply window has closed and the adapter should use a tag. */
  outsideReplyWindow: boolean
}

export type ChannelAdapter = {
  channel: ChatChannel
  /** null = no window rule (web). A Date = replies allowed until then. */
  replyWindowEndsAt(thread: ThreadLike): Date | null
  sendText(ctx: SendCtx, body: string): Promise<SendResult>
}
