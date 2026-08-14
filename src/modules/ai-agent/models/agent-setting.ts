import { model } from "@medusajs/framework/utils"

export const AgentSetting = model.define("ai_agent_setting", {
  id: model.text().primaryKey(),
  enabled: model.boolean().default(false),
  mode: model.enum(["shadow", "auto"]).default("shadow"),
  channels_enabled: model.json(),
  monthly_budget_usd_micros: model.number().default(22_000_000),
  spend_period: model.text(),
  spend_usd_micros: model.number().default(0),
  budget_alert_sent_at: model.dateTime().nullable(),
  // float, not number: model.number() maps to an integer column, so 0.7 would
  // store as 1 and every reply would fail the `confidence < threshold` gate in
  // lib/escalation.ts — the agent would escalate 100% of conversations.
  confidence_threshold: model.float().default(0.7),
  takeover_pause_hours: model.number().default(12),
})
