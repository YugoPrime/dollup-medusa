import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { isMetaIgConfigured } from "../../../../../../lib/meta-ig"
import { publishStorySlot } from "../../../../../../lib/publish-story-slot"

const inFlight = new Set<string>()

/**
 * Manual "Publish now" trigger for one slot. Same publish path as the cron;
 * surfaced as an admin button on the SlotCard / slot detail page.
 * Bypasses cooldown and attempt cap (operator decision).
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const slotId = req.params.id

  if (!isMetaIgConfigured()) {
    res.status(400).json({
      message:
        "Meta IG not configured: set META_PAGE_ACCESS_TOKEN + META_IG_BUSINESS_ACCOUNT_ID in env",
    })
    return
  }

  if (inFlight.has(slotId)) {
    res.status(409).json({ message: "Publish already in progress for this slot" })
    return
  }
  inFlight.add(slotId)

  try {
    const result = await publishStorySlot({ scope: req.scope, slotId })
    if (result.ok) {
      res.status(200).json({
        ok: true,
        media_id: result.media_id,
        creation_id: result.creation_id,
        duration_ms: result.duration_ms,
      })
      return
    }
    // Operator-triggered failures: surface the underlying status so the UI
    // can show the right thing (504 timeout vs 4xx config vs 5xx Meta).
    const status =
      result.status && result.status >= 400 && result.status < 600
        ? result.status
        : 502
    res.status(status).json({
      ok: false,
      message: result.error,
      fbtrace_id: result.fbtrace_id,
      meta_code: result.meta_code,
      attempt_count: result.attempt_count,
    })
  } catch (err) {
    console.error("[publish-now] unexpected error", err)
    res
      .status(500)
      .json({ message: (err as Error)?.message ?? "Publish failed" })
  } finally {
    inFlight.delete(slotId)
  }
}
