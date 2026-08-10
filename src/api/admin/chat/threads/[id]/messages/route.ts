import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CHAT_MODULE } from "../../../../../../modules/chat"
import { AI_AGENT_MODULE } from "../../../../../../modules/ai-agent"
import type AiAgentModuleService from "../../../../../../modules/ai-agent/service"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const chat: any = req.scope.resolve(CHAT_MODULE)
  const { id } = req.params
  const { limit = 200 } = req.query as Record<string, any>

  const messages = await chat.listMessages(
    { thread_id: id },
    { take: Number(limit), order: { created_at: "ASC" } }
  )
  res.json({ messages })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const chat: any = req.scope.resolve(CHAT_MODULE)
  const { id } = req.params
  const body = (req.body ?? {}) as {
    text?: string
    tag?: "HUMAN_AGENT" | null
    attachments?: Array<{ url_r2: string; mime: string; size?: number }>
  }

  const text = (body.text ?? "").toString()
  const hasText = text.trim().length > 0
  const hasAttachments =
    Array.isArray(body.attachments) && body.attachments.length > 0

  if (!hasText && !hasAttachments) {
    res.status(400).json({ error: "Must include text or attachments" })
    return
  }
  if (hasText && text.length > 2000) {
    res.status(400).json({ error: "Text exceeds 2000 chars" })
    return
  }
  if (hasAttachments && body.attachments!.length > 5) {
    res.status(400).json({ error: "Max 5 attachments per send" })
    return
  }

  // Resolve channel from the thread; routing per-channel keeps the API
  // surface stable as we add WhatsApp / Instagram in later phases.
  const [thread] = await chat.listThreads({ id })
  if (!thread) {
    res.status(404).json({ error: "thread not found" })
    return
  }
  // Any channel with a registered adapter can take a staff reply — Messenger
  // was the only one wired when this route was written, but chat.sendOutbound
  // is channel-agnostic now (it resolves the adapter itself). Only a channel
  // with no adapter at all (future Instagram/WhatsApp sub-projects) should
  // still 501 here, so probe resolveAdapter up front rather than hard-coding
  // "messenger".
  const { resolveAdapter } = await import(
    "../../../../../../modules/chat/adapters/index.js"
  )
  try {
    resolveAdapter(thread.channel)
  } catch {
    res.status(501).json({
      error: `Outbound not yet implemented for ${thread.channel}`,
    })
    return
  }

  const userId = (req as any).auth?.actor_id ?? null

  // The admin knob for how long a staff reply silences the agent
  // (Settings → AI → takeover_pause_hours) lives on the ai-agent module, not
  // chat. Resolve it here so sendOutbound gets the real configured value
  // instead of always falling back to its own 12h default. Both modules are
  // unconditionally registered in medusa-config.ts, but this is still
  // defensive: a settings-read hiccup must not block a staff reply.
  let takeoverPauseHours: number | undefined
  try {
    const agent = req.scope.resolve<AiAgentModuleService>(AI_AGENT_MODULE)
    const settings = await agent.getSettings()
    takeoverPauseHours = Number(settings.takeover_pause_hours)
  } catch {
    // Fall back to sendOutbound's own default rather than failing the send.
  }

  try {
    const messages: any[] = []
    let updatedThread: any = thread
    if (hasText) {
      const out = await chat.sendOutbound({
        threadId: id,
        body: text,
        senderKind: "staff",
        senderUserId: userId,
        takeoverPauseHours,
      })
      messages.push(out.message)
      updatedThread = out.thread
    }
    if (hasAttachments) {
      for (const a of body.attachments!) {
        const out = await chat.sendOutboundMessengerImage({
          threadId: id,
          attachment: a,
          senderUserId: userId,
          tag: body.tag ?? null,
        })
        messages.push(out.message)
        updatedThread = out.thread
      }
    }
    res.json({
      messages,
      thread: updatedThread,
      message: messages[messages.length - 1],
    })
  } catch (err) {
    const msg = (err as Error).message
    if (/Thread not found/.test(msg)) {
      res.status(404).json({ error: msg })
      return
    }
    if (/Outside 24h/.test(msg) || /Invalid attachment/.test(msg)) {
      res.status(400).json({ error: msg })
      return
    }
    res.status(400).json({ error: msg })
  }
}
