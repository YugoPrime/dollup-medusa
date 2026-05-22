import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CHAT_MODULE } from "../../../../../../modules/chat"

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
  if (thread.channel !== "messenger") {
    res.status(501).json({
      error: `Outbound not yet implemented for ${thread.channel}`,
    })
    return
  }

  const userId = (req as any).auth?.actor_id ?? null

  try {
    const messages: any[] = []
    let updatedThread: any = thread
    if (hasText) {
      const out = await chat.sendOutboundMessenger({
        threadId: id,
        text,
        senderUserId: userId,
        tag: body.tag ?? null,
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
