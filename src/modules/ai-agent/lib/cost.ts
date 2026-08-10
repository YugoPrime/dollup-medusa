export type AnthropicUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/**
 * Claude Sonnet 5 list price, in micro-dollars per token.
 *
 *   $3.00 / 1M input  → 3 micro-dollars per token
 *   $15.00 / 1M output → 15 micro-dollars per token
 *
 * Deliberately list price, NOT the $2/$10 introductory rate that ends
 * 2026-08-31 — budgeting on the intro rate would silently halve the effective
 * monthly ceiling the day it expires.
 */
const INPUT_MICROS_PER_TOKEN = 3
const OUTPUT_MICROS_PER_TOKEN = 15
const CACHE_READ_MULTIPLIER = 0.1
const CACHE_WRITE_MULTIPLIER = 1.25

/** Coerce anything the API might hand back into a non-negative finite number. */
function safe(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function costMicros(usage: AnthropicUsage): number {
  const input = safe(usage.input_tokens) * INPUT_MICROS_PER_TOKEN
  const output = safe(usage.output_tokens) * OUTPUT_MICROS_PER_TOKEN
  const cacheRead =
    safe(usage.cache_read_input_tokens) * INPUT_MICROS_PER_TOKEN * CACHE_READ_MULTIPLIER
  const cacheWrite =
    safe(usage.cache_creation_input_tokens) * INPUT_MICROS_PER_TOKEN * CACHE_WRITE_MULTIPLIER
  return Math.round(input + output + cacheRead + cacheWrite)
}
