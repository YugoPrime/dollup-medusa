export type PriceFormulaInputs = {
  cost_usd: number
  fx_rate: number
  landed_mult: number
  // Flat MUR amount added after FX × landed, before markup. Optional; defaults to
  // 0, which reproduces the legacy purely-multiplicative formula.
  flat_add?: number
  markup: number
  round_step: number
}

// Recommended selling price (MUR):
//   (cost_usd × fx_rate × landed_mult + flat_add) × markup, rounded UP to round_step.
// With flat_add=0 this is the legacy multiplicative formula. With
// fx_rate=51, landed_mult=1, flat_add=200, markup=2, round_step=1 it equals the
// boutique formula ((cost × 51) + 200) × 2 (e.g. 5.25 → 935.5).
export function recommendedPriceMur(i: PriceFormulaInputs): number {
  if (i.fx_rate <= 0) throw new Error("fx_rate must be > 0")
  if (i.landed_mult <= 0) throw new Error("landed_mult must be > 0")
  if (i.markup <= 0) throw new Error("markup must be > 0")
  if (i.round_step <= 0) throw new Error("round_step must be > 0")
  const flat = i.flat_add ?? 0
  if (flat < 0) throw new Error("flat_add must be >= 0")
  if (i.cost_usd <= 0) return 0
  const raw = (i.cost_usd * i.fx_rate * i.landed_mult + flat) * i.markup
  return Math.ceil(raw / i.round_step) * i.round_step
}
