import type { MedusaContainer } from "@medusajs/framework/types"

import { AI_AGENT_MODULE } from "../index"
import type AiAgentModuleService from "../service"
import { currentPeriod } from "./spend"

/**
 * The widget's only view of agent state. True only when every gate is open: env
 * kill switch off, settings enabled, auto (not shadow) mode, the web channel on,
 * and budget remaining. Exposes no reason — just the boolean.
 */
export async function isAiActive(scope: MedusaContainer): Promise<boolean> {
  if (process.env.AI_AGENT_ENABLED !== "true") return false
  try {
    const service = scope.resolve<AiAgentModuleService>(AI_AGENT_MODULE)
    const s = await service.getSettings()
    if (!s.enabled) return false
    if (s.mode !== "auto") return false
    if (!s.channels_enabled?.web) return false
    // Spend recorded in an earlier month is stale — it rolls over on next write.
    const spend = s.spend_period === currentPeriod() ? Number(s.spend_usd_micros) : 0
    return spend < Number(s.monthly_budget_usd_micros)
  } catch {
    // Module missing, DB unreachable, settings unreadable — degrade to the human
    // path rather than failing the customer's request.
    return false
  }
}
