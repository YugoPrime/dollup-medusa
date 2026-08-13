import Anthropic from "@anthropic-ai/sdk"

import { AGENT_MODEL, KNOWN_MODELS, isKnownModel } from "./pricing"

let client: Anthropic | null = null

export function getAnthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
    client = new Anthropic({ apiKey })
  }
  return client
}

// AI_AGENT_MODEL is free-form, so a typo or an unlisted model reaches the API
// untouched. priceFor() bills it at the most expensive known rate so spend can
// never be under-counted (see pricing.ts), but that silently shrinks the
// effective budget — say so loudly once at boot rather than leaving someone to
// wonder why the ceiling arrives early.
if (!isKnownModel(AGENT_MODEL)) {
  console.error(
    `[ai-agent] AI_AGENT_MODEL="${AGENT_MODEL}" is not in the pricing table. ` +
      `Spend will be billed at the most expensive known rate, so the monthly budget ` +
      `will exhaust early. Known models: ${KNOWN_MODELS.join(", ")}. ` +
      `Add it to MODEL_PRICING in src/modules/ai-agent/lib/pricing.ts to price it correctly.`,
  )
}

// Re-exported so existing call sites keep importing the model from here; the
// definition lives beside its price in ./pricing.ts.
export { AGENT_MODEL }
