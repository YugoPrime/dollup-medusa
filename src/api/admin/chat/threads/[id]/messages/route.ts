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
