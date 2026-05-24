/**
 * Pure pricing engine for SHEIN pre-orders.
 *
 * Single source of truth for the cost formula. No DB, no I/O.
 * Settings are passed in so callers can preview prices with overrides
 * (e.g. admin price-preview endpoint) without a DB round-trip.
 *
 * Formula (see spec 2026-05-25):
 *   USD → MUR via fx_rate
 *   + 25% customs
 *   + handling fee (banded by landed cost)
 *   round UP to nearest 10
 */

export type PreorderSettingsLike = {
  fx_rate_usd_to_mur: number
  customs_percent: number
  handling_tier_1_max: number
  handling_tier_1_fee: number
  handling_tier_2_max: number
  handling_tier_2_fee: number
  handling_tier_3_max: number
  handling_tier_3_fee: number
  handling_tier_4_flat: number
  handling_tier_4_percent: number
  round_to_mur: number
  eta_min_days: number
  eta_max_days: number
  deposit_percent: number
  submissions_per_ip_per_hour: number
  submissions_per_day_total: number
}

export const DEFAULT_PREORDER_SETTINGS: PreorderSettingsLike = {
  fx_rate_usd_to_mur: 50,
  customs_percent: 25,
  handling_tier_1_max: 500,
  handling_tier_1_fee: 150,
  handling_tier_2_max: 1000,
  handling_tier_2_fee: 300,
  handling_tier_3_max: 2000,
  handling_tier_3_fee: 600,
  handling_tier_4_flat: 1000,
  handling_tier_4_percent: 30,
  round_to_mur: 10,
  eta_min_days: 15,
  eta_max_days: 20,
  deposit_percent: 75,
  submissions_per_ip_per_hour: 5,
  submissions_per_day_total: 50,
}

export type ComputePreorderPriceInput = {
  sheinPriceUsd: number
}

export type ComputePreorderPriceResult = {
  sheinPriceUsd: number
  sheinPriceMur: number
  customsAmount: number
  landedCost: number
  handlingFee: number
  rawPrice: number
  finalPriceMur: number
  fxRateUsed: number
}

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step) * step
}

function computeHandlingFee(
  landedCost: number,
  settings: PreorderSettingsLike,
): number {
  if (landedCost < settings.handling_tier_1_max) {
    return settings.handling_tier_1_fee
  }
  if (landedCost < settings.handling_tier_2_max) {
    return settings.handling_tier_2_fee
  }
  if (landedCost < settings.handling_tier_3_max) {
    return settings.handling_tier_3_fee
  }
  const percentFee = (landedCost * settings.handling_tier_4_percent) / 100
  return Math.max(settings.handling_tier_4_flat, percentFee)
}

export function computePreorderPrice(
  input: ComputePreorderPriceInput,
  settings: PreorderSettingsLike,
): ComputePreorderPriceResult {
  const { sheinPriceUsd } = input

  if (!Number.isFinite(sheinPriceUsd)) {
    throw new Error("sheinPriceUsd must be a finite number")
  }
  if (sheinPriceUsd <= 0) {
    throw new Error("sheinPriceUsd must be positive (got " + sheinPriceUsd + ")")
  }

  const sheinPriceMur = sheinPriceUsd * settings.fx_rate_usd_to_mur
  const customsAmount = (sheinPriceMur * settings.customs_percent) / 100
  const landedCost = sheinPriceMur + customsAmount
  const handlingFee = computeHandlingFee(landedCost, settings)
  const rawPrice = landedCost + handlingFee
  const finalPriceMur = roundUpTo(rawPrice, settings.round_to_mur)

  return {
    sheinPriceUsd,
    sheinPriceMur,
    customsAmount,
    landedCost,
    handlingFee,
    rawPrice,
    finalPriceMur,
    fxRateUsed: settings.fx_rate_usd_to_mur,
  }
}
