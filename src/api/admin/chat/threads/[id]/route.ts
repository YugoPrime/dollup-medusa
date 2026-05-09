import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CHAT_MODULE } from "../../../../../modules/chat"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const chat: any = req.scope.resolve(CHAT_MODULE)
  const { id } = req.params
  const { unread_count, status } = req.body as {
    unread_count?: number
    status?: "open" | "snoozed" | "closed"
  }

  const patch: Record<string, any> = { id }
  if (unread_count !== undefined) patch.unread_count = unread_count
  if (status !== undefined) patch.status = status

  const updated = await chat.updateThreads(patch as any)
  res.json({ thread: updated })
}
