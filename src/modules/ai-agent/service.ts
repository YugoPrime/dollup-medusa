import { MedusaService } from "@medusajs/framework/utils"

import { AgentRun } from "./models/agent-run"
import { AgentSetting } from "./models/agent-setting"
import { KnowledgeEntry } from "./models/knowledge-entry"
import { computeSpendUpdate, currentPeriod } from "./lib/spend"

export const AGENT_SETTING_ID = "agset_default"

export type ChannelsEnabled = {
  web: boolean
  messenger: boolean
  instagram: boolean
  whatsapp: boolean
}

export type AgentSettingDTO = {
  id: string
  enabled: boolean
  mode: "shadow" | "auto"
  channels_enabled: ChannelsEnabled
  monthly_budget_usd_micros: number
  spend_period: string
  spend_usd_micros: number
  budget_alert_sent_at: Date | null
  confidence_threshold: number
  takeover_pause_hours: number
}

export { currentPeriod } from "./lib/spend"

class AiAgentModuleService extends MedusaService({
  AgentRun,
  AgentSetting,
  KnowledgeEntry,
}) {
  /**
   * The settings row is a singleton keyed by AGENT_SETTING_ID. Created on first
   * call with the documented defaults so every other accessor can assume it
   * exists rather than each caller handling a missing row.
   */
  async getSettings(): Promise<AgentSettingDTO> {
    const [existing] = await this.listAgentSettings({ id: AGENT_SETTING_ID })
    if (existing) {
      return existing as unknown as AgentSettingDTO
    }
    const created = await this.createAgentSettings({
      id: AGENT_SETTING_ID,
      enabled: false,
      mode: "shadow",
      channels_enabled: {
        web: true,
        messenger: false,
        instagram: false,
        whatsapp: false,
      },
      monthly_budget_usd_micros: 22_000_000,
      spend_period: currentPeriod(),
      spend_usd_micros: 0,
      budget_alert_sent_at: null,
      confidence_threshold: 0.7,
      takeover_pause_hours: 12,
    } as unknown as Parameters<this["createAgentSettings"]>[0])
    return created as unknown as AgentSettingDTO
  }

  async updateSettings(patch: Partial<Omit<AgentSettingDTO, "id">>): Promise<AgentSettingDTO> {
    await this.getSettings()
    const updated = await this.updateAgentSettings({
      id: AGENT_SETTING_ID,
      ...patch,
    } as unknown as Parameters<this["updateAgentSettings"]>[0])
    return updated as unknown as AgentSettingDTO
  }

  /**
   * Thin wrapper: load, delegate the arithmetic to the pure function, persist.
   * Every decision about money lives in computeSpendUpdate — this method makes
   * no judgment calls of its own.
   */
  async addSpend(
    micros: number,
  ): Promise<{ spend_usd_micros: number; crossed70: boolean; exhausted: boolean }> {
    const settings = await this.getSettings()
    const out = computeSpendUpdate({ settings, micros, now: new Date() })

    const patch: Record<string, unknown> = {
      id: AGENT_SETTING_ID,
      spend_usd_micros: out.spend_usd_micros,
      spend_period: out.spend_period,
    }
    if (out.crossed70) patch.budget_alert_sent_at = new Date()
    else if (out.clearAlert) patch.budget_alert_sent_at = null

    await this.updateAgentSettings(
      patch as unknown as Parameters<this["updateAgentSettings"]>[0],
    )

    return {
      spend_usd_micros: out.spend_usd_micros,
      crossed70: out.crossed70,
      exhausted: out.exhausted,
    }
  }
}

export default AiAgentModuleService
