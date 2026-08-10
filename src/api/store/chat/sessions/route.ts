import type { MedusaResponse, MedusaStoreRequest } from "@medusajs/framework/http"

import { newSessionId } from "../../../../modules/chat/lib/session-id"
import { isAiActive } from "../../../../modules/ai-agent/lib/is-active"

export const POST = async (req: MedusaStoreRequest, res: MedusaResponse) => {
  if (process.env.STORE_CHAT_ENABLED !== "true") {
    res.status(404).json({ message: "Not found" })
    return
  }
  // Contact and Thread are created lazily on the first message, so opening the
  // widget and walking away costs nothing.
  res.json({
    session_id: newSessionId(),
    ai_active: await isAiActive(req.scope),
  })
}
