import Anthropic from "@anthropic-ai/sdk"

let client: Anthropic | null = null

export function getAnthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
    client = new Anthropic({ apiKey })
  }
  return client
}

export const AGENT_MODEL = process.env.AI_AGENT_MODEL ?? "claude-sonnet-5"
