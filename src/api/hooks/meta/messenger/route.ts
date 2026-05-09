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
  // 1. Read raw body (populated by express.raw() in middlewares.ts)
  const rawBody = req.body as Buffer

  // 2. Verify HMAC first — unauthenticated callers get 401 before we reveal
  //    anything about our internal state (including whether the flag is on/off).
  const signature = req.headers["x-hub-signature-256"] as string | undefined
  const secret = process.env.META_APP_SECRET || ""
  if (!verifyMetaSignature(rawBody, signature, secret)) {
    res.status(401).send("bad signature")
    return
  }

  // 3. Check feature flag AFTER HMAC — only authenticated Meta deliveries see
  //    this response, so no info-leak. Also means a misconfigured prod flag
  //    won't silently 200 real events and confuse Meta's retry logic.
  if (process.env.CHAT_MODULE_ENABLED !== "true") {
    res.status(200).send("disabled")
    return
  }

  // 4. Parse JSON
  let payload: any
  try {
    payload = JSON.parse(rawBody.toString("utf8"))
  } catch {
    res.status(400).send("invalid json")
    return
  }
  if (payload.object !== "page") {
    // Meta sometimes ships warmup/health events that aren't `page` objects.
    res.status(200).send("ignored")
    return
  }

  // 5. Process events with per-event error isolation.
  //    If one event fails the others still get ingested; Meta only retries
  //    if we made ZERO progress on the batch.
  const chat: any = req.scope.resolve(CHAT_MODULE)
  let totalEvents = 0
  let failedEvents = 0

  for (const entry of payload.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      // Skip non-message events (delivery / read receipts come in Phase 2)
      // and skip echo events from our own outbound messages.
      if (!ev.message || ev.message.is_echo) continue
      totalEvents++
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
          "[hooks/meta/messenger] ingest failed for event",
          ev.message?.mid,
          (err as Error).message
        )
        failedEvents++
        // Continue to next event — don't abort the whole batch.
      }
    }
  }

  // Return 500 only when every event failed so Meta retries the full batch.
  // Partial success → 200 (Meta won't retry already-ingested events anyway).
  if (totalEvents > 0 && failedEvents === totalEvents) {
    res.status(500).send("ingest failed")
    return
  }
  res.status(200).send("ok")
}
