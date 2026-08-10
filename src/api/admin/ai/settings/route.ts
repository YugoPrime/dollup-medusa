import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { AI_AGENT_MODULE } from "../../../../modules/ai-agent"
import type AiAgentModuleService from "../../../../modules/ai-agent/service"
import type { ChannelsEnabled } from "../../../../modules/ai-agent/service"

const CHANNEL_KEYS = ["web", "messenger", "instagram", "whatsapp"] as const
type ChannelKey = (typeof CHANNEL_KEYS)[number]

/**
 * Accept only the four known channel keys with boolean values. Anything else
 * (unknown key, non-boolean value, non-object) is rejected outright rather
 * than silently ignored — the takeover guard reads `channels_enabled?.[channel]`,
 * so a malformed value here would quietly disable the agent on that channel.
 */
function validateChannelsPatch(
  raw: unknown,
): Partial<Record<ChannelKey, boolean>> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null
  }
  const out: Partial<Record<ChannelKey, boolean>> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(CHANNEL_KEYS as readonly string[]).includes(key)) {
      return null
    }
    if (typeof value !== "boolean") {
      return null
    }
    out[key as ChannelKey] = value
  }
  return out
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve<AiAgentModuleService>(AI_AGENT_MODULE)
  res.json({ settings: await service.getSettings() })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve<AiAgentModuleService>(AI_AGENT_MODULE)
  const body = (req.body ?? {}) as Record<string, unknown>

  // Explicit allowlist — do NOT switch this to `...body`. spend_usd_micros and
  // spend_period are the record of what the shop has actually spent, derived
  // from real API usage in addSpend(); a writable copy here would let one bad
  // request (or a careless UI form) erase that history. budget_alert_sent_at
  // is likewise owned by addSpend()'s crossed-70%/exhausted bookkeeping. Every
  // field below is picked and validated one at a time on purpose.
  const patch: Record<string, unknown> = {}

  if (typeof body.enabled === "boolean") {
    patch.enabled = body.enabled
  }

  if (body.mode === "shadow" || body.mode === "auto") {
    patch.mode = body.mode
  }

  if (body.channels_enabled !== undefined) {
    const validated = validateChannelsPatch(body.channels_enabled)
    if (!validated) {
      res.status(400).json({
        message:
          "channels_enabled must be an object containing only boolean web, messenger, instagram, whatsapp keys",
      })
      return
    }
    // Merge over the current value so a caller sending only { web: true }
    // doesn't silently switch messenger/instagram/whatsapp off.
    const current = await service.getSettings()
    patch.channels_enabled = {
      ...current.channels_enabled,
      ...validated,
    } satisfies ChannelsEnabled
  }

  if (body.monthly_budget_usd_micros !== undefined) {
    const n = Number(body.monthly_budget_usd_micros)
    if (!Number.isFinite(n) || n < 0) {
      // Zero is meaningful ("spend nothing" — computeSpendUpdate treats it as
      // exhausted) so it stays allowed; only negative values are a caller bug.
      res.status(400).json({
        message: "monthly_budget_usd_micros must be a non-negative number",
      })
      return
    }
    patch.monthly_budget_usd_micros = Math.round(n)
  }

  if (Number.isFinite(Number(body.confidence_threshold))) {
    patch.confidence_threshold = Math.min(
      1,
      Math.max(0, Number(body.confidence_threshold)),
    )
  }

  if (Number.isFinite(Number(body.takeover_pause_hours))) {
    patch.takeover_pause_hours = Math.max(
      0,
      Math.round(Number(body.takeover_pause_hours)),
    )
  }

  res.json({ settings: await service.updateSettings(patch as never) })
}
