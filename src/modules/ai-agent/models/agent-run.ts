import { model } from "@medusajs/framework/utils"

export const AgentRun = model.define("ai_agent_run", {
  id: model.id({ prefix: "agr" }).primaryKey(),
  thread_id: model.text(),
  message_id: model.text(),
  channel: model.text(),
  status: model.enum(["skipped", "replied", "escalated", "failed"]),
  skip_reason: model.text().nullable(),
  intent: model.text().nullable(),
  confidence: model.number().nullable(),
  escalation_reason: model.text().nullable(),
  language: model.text().nullable(),
  tools_used: model.json().nullable(),
  model: model.text().nullable(),
  input_tokens: model.number().default(0),
  output_tokens: model.number().default(0),
  cache_read_input_tokens: model.number().default(0),
  // Integer micro-dollars. Never a float, and never cents — a single run can
  // cost a fraction of a cent and cents would round it to zero.
  cost_usd_micros: model.number().default(0),
  latency_ms: model.number().default(0),
  error: model.text().nullable(),
})
