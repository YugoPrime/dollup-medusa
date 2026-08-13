/**
 * The model the concierge runs on, and what that model costs — deliberately in
 * ONE file.
 *
 * These were previously separate: `AI_AGENT_MODEL` was env-configurable while
 * the per-token rates were hardcoded constants for Claude Sonnet 5. Pointing the
 * env var at a cheaper model therefore kept billing the agent at Sonnet rates —
 * on Haiku 4.5 that is 3x the real spend, so the monthly budget would exhaust
 * after roughly a third of the conversations it was sized for and the kill
 * switch would fire early. Co-locating them means the model and its price can
 * never drift apart again: adding a model to `MODEL_PRICING` is the only way to
 * make it selectable.
 *
 * Rates are Anthropic **list price**, never an introductory rate. Sonnet 5 is
 * $2/$10 through 2026-08-31; budgeting on that would silently halve the
 * effective monthly ceiling the day it expires.
 */

export type ModelPricing = {
  /** Micro-dollars per input token. $3.00/MTok → 3. */
  inputMicrosPerToken: number
  /** Micro-dollars per output token. $15.00/MTok → 15. */
  outputMicrosPerToken: number
  /**
   * Minimum prompt length, in tokens, before a `cache_control` breakpoint does
   * anything. Below it the API silently declines to cache — no error, just
   * `cache_creation_input_tokens: 0` and full price on every call.
   *
   * This is NOT uniform across the range and does not track price: Sonnet 5
   * caches from 1024 tokens, Haiku 4.5 needs 4096. A prefix that caches happily
   * on Sonnet can stop caching entirely on the "cheaper" model, which eats most
   * of the saving. See `assessCaching()`.
   */
  cacheMinimumTokens: number
}

/**
 * Every model the concierge is allowed to run on. Keys are exact Anthropic
 * model IDs — no date suffixes, no aliases.
 */
export const MODEL_PRICING = {
  "claude-opus-5": {
    inputMicrosPerToken: 5,
    outputMicrosPerToken: 25,
    cacheMinimumTokens: 512,
  },
  "claude-opus-4-8": {
    inputMicrosPerToken: 5,
    outputMicrosPerToken: 25,
    cacheMinimumTokens: 1024,
  },
  "claude-sonnet-5": {
    inputMicrosPerToken: 3,
    outputMicrosPerToken: 15,
    cacheMinimumTokens: 1024,
  },
  "claude-sonnet-4-6": {
    inputMicrosPerToken: 3,
    outputMicrosPerToken: 15,
    cacheMinimumTokens: 1024,
  },
  "claude-haiku-4-5": {
    inputMicrosPerToken: 1,
    outputMicrosPerToken: 5,
    cacheMinimumTokens: 4096,
  },
} as const satisfies Record<string, ModelPricing>

export type KnownModel = keyof typeof MODEL_PRICING

export const DEFAULT_MODEL: KnownModel = "claude-sonnet-5"

/**
 * Cache multipliers, applied to the model's input rate. Uniform across models.
 *
 * The 1.25x write multiplier is the 5-minute TTL rate, which is what
 * buildSystemBlocks() requests (`{type: "ephemeral"}` with no `ttl`). A 1-hour
 * TTL would be 2x — if the prompt ever asks for one, this must change with it.
 */
export const CACHE_READ_MULTIPLIER = 0.1
export const CACHE_WRITE_MULTIPLIER = 1.25

export function isKnownModel(model: string): model is KnownModel {
  return Object.prototype.hasOwnProperty.call(MODEL_PRICING, model)
}

export const KNOWN_MODELS = Object.keys(MODEL_PRICING) as KnownModel[]

/** The priciest entry in the table — the fallback for an unrecognized model. */
function mostExpensivePricing(): ModelPricing {
  return KNOWN_MODELS.map((m) => MODEL_PRICING[m]).reduce((worst, p) =>
    p.outputMicrosPerToken > worst.outputMicrosPerToken ? p : worst,
  )
}

/**
 * Rates for a model. An unrecognized ID bills at the **most expensive** known
 * rate rather than throwing or defaulting to Sonnet.
 *
 * Throwing would take the whole Medusa boot down over a typo in an optional env
 * var, and this feature is built to fail safe (hand off to a human), not to
 * crash the store. Defaulting to Sonnet would under-bill a pricier model and let
 * real spend run past the ceiling — the exact failure this file exists to
 * prevent. Over-billing is the safe direction: the budget trips early and a
 * human takes over, which is the designed degraded state.
 */
export function priceFor(model: string): ModelPricing {
  return isKnownModel(model) ? MODEL_PRICING[model] : mostExpensivePricing()
}

/**
 * The model in use. Set `AI_AGENT_MODEL` to any key of MODEL_PRICING.
 *
 * Read once at module load, matching how the Anthropic client is constructed —
 * changing it needs a restart.
 */
export const AGENT_MODEL: string = process.env.AI_AGENT_MODEL ?? DEFAULT_MODEL

export type CachingAssessment = {
  model: string
  cacheMinimumTokens: number
  prefixTokens: number
  /** False when the prefix is too short for this model to cache it at all. */
  caches: boolean
  /** How many more tokens the prefix needs before caching engages. 0 when it already does. */
  shortfallTokens: number
}

/**
 * Whether a cached prefix of `prefixTokens` actually caches on `model`.
 *
 * Worth checking before switching models on cost grounds: the saving assumes the
 * prefix keeps being billed at the 0.1x cache-read rate, and dropping below the
 * new model's minimum quietly moves it back to full price on every call.
 */
export function assessCaching(model: string, prefixTokens: number): CachingAssessment {
  const { cacheMinimumTokens } = priceFor(model)
  const tokens = Number.isFinite(prefixTokens) && prefixTokens > 0 ? Math.round(prefixTokens) : 0
  const caches = tokens >= cacheMinimumTokens
  return {
    model,
    cacheMinimumTokens,
    prefixTokens: tokens,
    caches,
    shortfallTokens: caches ? 0 : cacheMinimumTokens - tokens,
  }
}
