/**
 * Measures the concierge's real cached prefix and prices a conversation on every
 * model in the pricing table.
 *
 * Answers the two questions that decide whether switching to a cheaper model is
 * worth it:
 *   1. How many tokens is the cached prefix (tool schemas + system prompt +
 *      knowledge base)?
 *   2. Does that prefix clear each model's cache minimum? Below it the API
 *      silently stops caching and most of the saving disappears — Haiku 4.5
 *      needs 4096 tokens where Sonnet 5 needs 1024.
 *
 * Standalone on purpose: needs only ANTHROPIC_API_KEY, no database and no
 * running Medusa. Do NOT reach for `medusa exec` here — it boots a second full
 * Medusa instance alongside the server and OOMs the production container.
 *
 *   ANTHROPIC_API_KEY=sk-ant-... npx ts-node src/scripts/check-agent-model-economics.ts
 *
 * Flags (all optional):
 *   --kb <file.json>   Knowledge entries to include: [{ "id", "title", "body" }]
 *   --calls <n>        Model calls per conversation        (default 12)
 *   --history <n>      Avg uncached input tokens per call  (default 1200)
 *   --output <n>       Avg output tokens per call          (default 180)
 *   --budget <usd>     Monthly ceiling                     (default 22)
 */
import * as fs from "fs"

import Anthropic from "@anthropic-ai/sdk"

import { buildSystemBlocks, type KnowledgeEntryLike } from "../modules/ai-agent/lib/prompt"
import { TOOL_DEFINITIONS } from "../modules/ai-agent/lib/tools"
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  KNOWN_MODELS,
  MODEL_PRICING,
  assessCaching,
} from "../modules/ai-agent/lib/pricing"

function flag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const n = Number(process.argv[i + 1])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function loadKnowledge(): KnowledgeEntryLike[] {
  const i = process.argv.indexOf("--kb")
  if (i === -1) return []
  const path = process.argv[i + 1]
  if (!path) throw new Error("--kb needs a file path")
  const parsed = JSON.parse(fs.readFileSync(path, "utf8"))
  if (!Array.isArray(parsed)) throw new Error(`${path} must contain a JSON array`)
  return parsed as KnowledgeEntryLike[]
}

function usd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error(
      "ANTHROPIC_API_KEY is not set.\n" +
        "Create a key at https://console.anthropic.com/settings/keys and re-run:\n" +
        "  ANTHROPIC_API_KEY=sk-ant-... npx ts-node src/scripts/check-agent-model-economics.ts",
    )
    process.exit(1)
  }

  const calls = flag("calls", 12)
  const history = flag("history", 1200)
  const output = flag("output", 180)
  const budgetUsd = flag("budget", 22)

  const knowledge = loadKnowledge()
  const system = buildSystemBlocks(knowledge)

  const client = new Anthropic({ apiKey })

  // Count against the cheapest model purely to get the number — token counts are
  // model-specific, so each model is measured on its own below.
  console.log(`knowledge entries: ${knowledge.length}`)
  console.log(`system prompt:     ${system[0].text.length} chars`)
  console.log(`tools:             ${TOOL_DEFINITIONS.length}`)
  console.log("")

  const rows: string[] = []
  for (const model of KNOWN_MODELS) {
    // tools + system is exactly the cached prefix: they render before messages,
    // and buildSystemBlocks puts the single cache breakpoint at the end of system.
    const counted = await client.messages.countTokens({
      model,
      system: system as Anthropic.TextBlockParam[],
      tools: TOOL_DEFINITIONS as unknown as Anthropic.Tool[],
      messages: [{ role: "user", content: "bonjour" }],
    })
    const prefix = counted.input_tokens
    const cache = assessCaching(model, prefix)
    const { inputMicrosPerToken, outputMicrosPerToken } = MODEL_PRICING[model]

    // With caching: prefix written once, then read at 0.1x on every call.
    // Without: prefix billed as fresh input on every single call.
    const prefixMicros = cache.caches
      ? prefix * inputMicrosPerToken * CACHE_WRITE_MULTIPLIER +
        calls * prefix * inputMicrosPerToken * CACHE_READ_MULTIPLIER
      : calls * prefix * inputMicrosPerToken

    const perConversation = Math.round(
      prefixMicros +
        calls * history * inputMicrosPerToken +
        calls * output * outputMicrosPerToken,
    )
    const perMonth = Math.floor((budgetUsd * 1_000_000) / perConversation)

    rows.push(
      [
        model.padEnd(20),
        String(prefix).padStart(6),
        String(cache.cacheMinimumTokens).padStart(6),
        (cache.caches ? "yes" : `NO (+${cache.shortfallTokens})`).padEnd(12),
        usd(perConversation).padStart(9),
        String(perMonth).padStart(7),
      ].join("  "),
    )
  }

  console.log(
    ["model".padEnd(20), "prefix", "cachMin", "caches?".padEnd(12), "  $/conv", "conv/mo"].join(
      "  ",
    ),
  )
  console.log("-".repeat(72))
  rows.forEach((r) => console.log(r))
  console.log("")
  console.log(
    `assumptions: ${calls} model calls/conversation, ${history} uncached input tokens/call, ` +
      `${output} output tokens/call, $${budgetUsd}/month budget`,
  )
  console.log(
    "a 'NO' in caches? means the prefix is too short for that model to cache — " +
      "the $/conv figure already reflects the full-price prefix on every call.",
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
