import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { CHAT_MODULE } from "../../../../modules/chat"
import { verifyMetaSignature } from "../../../../modules/chat/lib/verify-meta-signature"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const mode = req.query["hub.mode"]
  const token = req.query["hub.verify_token"]
  const challenge = req.query["hub.challenge"]
  const expected = process.env.META_MESSENGER_VERIFY_TOKEN
  if (mode === "subscribe" && token && expected && token === expected) {
    res.status(200).send(challenge as string)
    return
  }
  res.status(403).send("forbidden")
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  // Feature flag — keep the route inert until we're ready to receive prod traffic.
  if (process.env.CHAT_MODULE_ENABLED !== "true") {
    res.status(200).send("disabled")
    return
  }
  const raw = req.body as Buffer
  const signature = req.headers["x-hub-signature-256"] as string | undefined
  const secret = process.env.META_APP_SECRET || ""
  if (!verifyMetaSignature(raw, signature, secret)) {
    res.status(401).send("bad signature")
    return
  }
  let payload: any
  try {
    payload = JSON.parse(raw.toString("utf8"))
  } catch {
    res.status(400).send("invalid json")
    return
  }
  if (payload.object !== "page") {
    // Meta sometimes ships warmup/health events that aren't `page` objects.
    res.status(200).send("ignored")
    return
  }

  const chat: any = req.scope.resolve(CHAT_MODULE)

  for (const entry of payload.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      // Skip non-message events (delivery / read receipts come in Phase 2)
      // and skip echo events from our own outbound messages.
      if (!ev.message || ev.message.is_echo) continue
      try {
        await chat.ingestInboundMessenger({
          pageId: entry.id,
          senderId: ev.sender.id,
          messageId: ev.message.mid,
          text: ev.message.text ?? null,
          attachments: (ev.message.attachments ?? []).map((a: any) => ({
            type: a.type,
            url: a.payload?.url,
            mime: undefined,
          })),
          timestamp: ev.timestamp,
          senderProfile: undefined,
        })
      } catch (err) {
        console.error(
          "[hooks/meta/messenger] ingest failed",
          (err as Error).message
        )
        // Returning 5xx prompts Meta to retry the WHOLE webhook payload, which
        // is what we want when storage fails — better than silently dropping.
        res.status(500).send("ingest failed")
        return
      }
    }
  }
  res.status(200).send("ok")
}
