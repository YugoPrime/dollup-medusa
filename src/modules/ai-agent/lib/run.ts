import type { MedusaContainer } from "@medusajs/framework/types"

import { AGENT_MODEL, getAnthropic } from "./anthropic"
import { costMicros } from "./cost"
import { executeTool, TOOL_DEFINITIONS } from "./tools"

const MAX_TOOL_ROUNDS = 4
const WALL_CLOCK_MS = 30_000
const MAX_TOKENS = 1024

export type AgentOutcome = {
  terminal: "reply" | "escalate" | "timeout"
  reply: { text: string; confidence: number; intent: string; language: string } | null
  escalation: { reason: string; severity: "normal" | "urgent" } | null
  toolsUsed: Array<{ name: string; ms: number; ok: boolean }>
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
  }
  costMicros: number
  latencyMs: number
  error: string | null
}

type SystemBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
type HistoryTurn = { role: "user" | "assistant"; content: string }

/**
 * One agent run: model call → tools → model call → … until a terminal tool.
 *
 * Manual loop rather than the SDK tool runner: the runner is beta, and here we
 * want a hard round cap, a wall clock, and per-tool timing for the audit row.
 *
 * Sonnet 5 notes baked in below and easy to get wrong:
 *  - thinking is ON by default when omitted; set it explicitly at low effort.
 *  - temperature/top_p/top_k are rejected outright — never send them.
 *  - no assistant prefill.
 */
export async function runAgent(input: {
  scope: MedusaContainer
  systemBlocks: SystemBlock[]
  history: HistoryTurn[]
}): Promise<AgentOutcome> {
  const started = Date.now()
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  }
  const toolsUsed: AgentOutcome["toolsUsed"] = []

  const finish = (
    partial: Pick<AgentOutcome, "terminal" | "reply" | "escalation" | "error">,
  ): AgentOutcome => ({
    ...partial,
    toolsUsed,
    usage,
    costMicros: costMicros(usage),
    latencyMs: Date.now() - started,
  })

  const anthropic = getAnthropic()
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = input.history.map(
    (t) => ({ role: t.role, content: t.content }),
  )

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      if (Date.now() - started > WALL_CLOCK_MS) {
        return finish({ terminal: "timeout", reply: null, escalation: null, error: null })
      }

      const response = await anthropic.messages.create({
        model: AGENT_MODEL,
        max_tokens: MAX_TOKENS,
        system: input.systemBlocks as never,
        messages: messages as never,
        tools: TOOL_DEFINITIONS as never,
        thinking: { type: "adaptive" },
        output_config: { effort: "low" },
      } as never)

      const u = (response as unknown as { usage?: Record<string, number> }).usage ?? {}
      usage.input_tokens += Number(u.input_tokens ?? 0)
      usage.output_tokens += Number(u.output_tokens ?? 0)
      usage.cache_read_input_tokens += Number(u.cache_read_input_tokens ?? 0)
      usage.cache_creation_input_tokens += Number(u.cache_creation_input_tokens ?? 0)

      const blocks = (response as { content?: Array<Record<string, any>> }).content ?? []
      const toolUses = blocks.filter((b) => b.type === "tool_use")

      // Terminal tools end the run immediately.
      const reply = toolUses.find((b) => b.name === "send_reply")
      if (reply) {
        const i = reply.input as Record<string, unknown>
        const text = String(i.text ?? "").trim()
        if (!text) {
          // strict:true + the tool schema guarantee the shape, not the
          // substance — an empty/whitespace-only text is a malformed
          // terminal call. Sending it would mean silence reaches a real
          // customer with a confidence score attached. Escalate to a human
          // instead of trusting it.
          return finish({ terminal: "timeout", reply: null, escalation: null, error: null })
        }
        return finish({
          terminal: "reply",
          reply: {
            text,
            confidence: Number(i.confidence ?? 0),
            intent: String(i.intent ?? "other"),
            language: String(i.language ?? "fr"),
          },
          escalation: null,
          error: null,
        })
      }

      const escalate = toolUses.find((b) => b.name === "escalate_to_human")
      if (escalate) {
        const i = escalate.input as Record<string, unknown>
        return finish({
          terminal: "escalate",
          reply: null,
          escalation: {
            reason: String(i.reason ?? "unspecified"),
            severity: i.severity === "urgent" ? "urgent" : "normal",
          },
          error: null,
        })
      }

      if (toolUses.length === 0) {
        // No tool call at all and no terminal tool: the model answered in prose,
        // which the prompt forbids. Treat as a timeout so a human picks it up
        // rather than sending unstructured text with no confidence signal.
        return finish({ terminal: "timeout", reply: null, escalation: null, error: null })
      }

      messages.push({ role: "assistant", content: blocks })
      const results: Array<Record<string, unknown>> = []
      for (const call of toolUses) {
        const t0 = Date.now()
        try {
          const out = await executeTool(input.scope, call.name, call.input ?? {})
          toolsUsed.push({ name: call.name, ms: Date.now() - t0, ok: true })
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: JSON.stringify(out),
          })
        } catch (e) {
          toolsUsed.push({ name: call.name, ms: Date.now() - t0, ok: false })
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: `Erreur: ${(e as Error).message}`,
            is_error: true,
          })
        }
      }
      messages.push({ role: "user", content: results })
    }

    // Ran out of rounds without a terminal tool.
    return finish({ terminal: "timeout", reply: null, escalation: null, error: null })
  } catch (e) {
    return finish({
      terminal: "timeout",
      reply: null,
      escalation: null,
      error: (e as Error).message,
    })
  }
}
