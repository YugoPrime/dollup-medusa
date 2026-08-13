import {
  AGENT_MODEL,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  priceFor,
} from "./pricing"

export type AnthropicUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/** Coerce anything the API might hand back into a non-negative finite number. */
function safe(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Cost of one model call in micro-dollars, at the given model's list price.
 *
 * `model` defaults to the configured AI_AGENT_MODEL, so the figure always tracks
 * whatever the agent actually ran on. Rates live in ./pricing.ts — see the
 * header there for why they are not constants in this file.
 */
export function costMicros(usage: AnthropicUsage, model: string = AGENT_MODEL): number {
  const { inputMicrosPerToken, outputMicrosPerToken } = priceFor(model)

  const input = safe(usage.input_tokens) * inputMicrosPerToken
  const output = safe(usage.output_tokens) * outputMicrosPerToken
  const cacheRead =
    safe(usage.cache_read_input_tokens) * inputMicrosPerToken * CACHE_READ_MULTIPLIER
  const cacheWrite =
    safe(usage.cache_creation_input_tokens) * inputMicrosPerToken * CACHE_WRITE_MULTIPLIER

  return Math.round(input + output + cacheRead + cacheWrite)
}
