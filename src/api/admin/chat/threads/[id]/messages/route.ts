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
  }

  const text = (body.text ?? "").toString()
  if (!text.trim()) {
    res.status(400).json({ error: "text is required" })
    return
  }
  if (text.length > 2000) {
    res.status(400).json({ error: "text exceeds 2000 chars" })
    return
  }

  // Resolve channel from the thread; routing per-channel keeps the API
  // surface stable as we add WhatsApp / Instagram in later phases.
  const [thread] = await chat.listThreads({ id })
  if (!thread) {
    res.status(404).json({ error: "thread not found" })
    return
  }

  const userId = (req as any).auth?.actor_id ?? null

  try {
    let result: { message: any; thread: any }
    if (thread.channel === "messenger") {
      result = await chat.sendOutboundMessenger({
        threadId: id,
        text,
        senderUserId: userId,
        tag: body.tag ?? null,
      })
    } else {
      res.status(501).json({
        error: `Outbound not yet implemented for ${thread.channel}`,
      })
      return
    }
    res.json({ message: result.message, thread: result.thread })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
}
