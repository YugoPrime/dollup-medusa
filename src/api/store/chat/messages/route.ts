import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { CHAT_MODULE } from "../../../../modules/chat"
import type ChatModuleService from "../../../../modules/chat/service"
import { isValidSessionId } from "../../../../modules/chat/lib/session-id"
import { isAiActive } from "../../../../modules/ai-agent/lib/is-active"
import {
  checkAndIncrement,
  dayBucket,
  hourBucket,
  IP_DAILY_LIMIT,
  MAX_MESSAGE_CHARS,
  SESSION_HOURLY_LIMIT,
} from "../rate-limit"

type PublicMessage = {
  id: string
  direction: "inbound" | "outbound"
  sender_kind: "customer" | "staff" | "ai"
  body: string | null
  created_at: string
}

function sessionOf(req: MedusaStoreRequest): string | null {
  const raw = req.headers["x-dub-chat-session"]
  const value = Array.isArray(raw) ? raw[0] : raw
  return isValidSessionId(value) ? (value as string) : null
}

function clientIp(req: MedusaStoreRequest): string {
  const fwd = req.headers["x-forwarded-for"]
  const first = Array.isArray(fwd) ? fwd[0] : fwd
  return (first ?? "").split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown"
}

/** Resolves the thread from the session header ONLY — never from client input. */
async function threadForSession(chat: ChatModuleService, sessionId: string) {
  const [contact] = await chat.listContacts({ channel: "web", external_id: sessionId })
  if (!contact) return null
  const [thread] = await chat.listThreads({
    channel: "web",
    contact_id: (contact as any).id,
  })
  return thread ?? null
}

export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  if (process.env.STORE_CHAT_ENABLED !== "true") {
    res.status(404).json({ message: "Not found" })
    return
  }
  const sessionId = sessionOf(req)
  if (!sessionId) {
    res.status(401).json({ message: "Missing or malformed session" })
    return
  }

  const body = (req.body ?? {}) as { text?: unknown }
  const text = typeof body.text === "string" ? body.text.trim() : ""
  if (!text) {
    res.status(400).json({ message: "text is required" })
    return
  }
  if (text.length > MAX_MESSAGE_CHARS) {
    res.status(400).json({ message: `text must be ${MAX_MESSAGE_CHARS} characters or fewer` })
    return
  }

  const cache = req.scope.resolve(Modules.CACHE)
  const perSession = await checkAndIncrement(
    cache as never,
    `chat:rl:s:${sessionId}:${hourBucket()}`,
    SESSION_HOURLY_LIMIT,
    3600,
  )
  const perIp = await checkAndIncrement(
    cache as never,
    `chat:rl:ip:${clientIp(req)}:${dayBucket()}`,
    IP_DAILY_LIMIT,
    86_400,
  )
  if (!perSession.allowed || !perIp.allowed) {
    // Nothing is persisted and no agent run is spent.
    res.status(429).json({
      message: "Un instant — vous avez envoyé beaucoup de messages. Réessayez dans un moment.",
    })
    return
  }

  const chat = req.scope.resolve<ChatModuleService>(CHAT_MODULE)
  const { message, thread } = await chat.ingestInboundWeb({ sessionId, text })

  // Hand off to the agent asynchronously so this request returns immediately and
  // the widget can show its typing indicator. A subscriber picks this up in
  // Phase 4; until then nothing listens and the message simply waits in /inbox.
  const events = req.scope.resolve(Modules.EVENT_BUS)
  await events
    .emit({
      name: "chat.message.received",
      data: { message_id: (message as any).id, thread_id: (thread as any).id },
    })
    .catch((e: Error) => {
      req.scope
        .resolve(ContainerRegistrationKeys.LOGGER)
        .error(`[store-chat] event emit failed: ${e.message}`)
    })

  res.json({ message_id: (message as any).id })
}

export const GET = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  if (process.env.STORE_CHAT_ENABLED !== "true") {
    res.status(404).json({ message: "Not found" })
    return
  }
  const sessionId = sessionOf(req)
  if (!sessionId) {
    res.status(401).json({ message: "Missing or malformed session" })
    return
  }

  const chat = req.scope.resolve<ChatModuleService>(CHAT_MODULE)
  const thread = await threadForSession(chat, sessionId)

  let messages: PublicMessage[] = []
  if (thread) {
    const sinceRaw = (req.query as Record<string, unknown>).since
    const since = typeof sinceRaw === "string" ? Date.parse(sinceRaw) : NaN
    const rows = await chat.listMessages(
      { thread_id: (thread as any).id },
      { order: { created_at: "ASC" }, take: 200 },
    )
    messages = (rows as any[])
      .filter((m) => !Number.isFinite(since) || new Date(m.created_at).getTime() > since)
      // An outbound row exists before it is actually delivered, and a failed send
      // must never look to the customer like a reply that arrived. Inbound rows
      // are always shown — those are the customer's own messages.
      .filter((m) => m.direction === "inbound" || (m.meta_status !== "pending" && m.meta_status !== "failed"))
      .map((m) => ({
        id: m.id,
        direction: m.direction,
        sender_kind: m.sender_kind,
        body: m.body,
        created_at: new Date(m.created_at).toISOString(),
      }))
  }

  res.setHeader("Cache-Control", "no-store")
  res.json({ messages, ai_active: await isAiActive(req.scope) })
}
