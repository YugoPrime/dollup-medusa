export type PriceFormulaInputs = {
  cost_usd: number
  fx_rate: number
  landed_mult: number
  markup: number
  round_step: number
}

export function recommendedPriceMur(i: PriceFormulaInputs): number {
  if (i.fx_rate <= 0) throw new Error("fx_rate must be > 0")
  if (i.landed_mult <= 0) throw new Error("landed_mult must be > 0")
  if (i.markup <= 0) throw new Error("markup must be > 0")
  if (i.round_step <= 0) throw new Error("round_step must be > 0")
  if (i.cost_usd <= 0) return 0
  const raw = i.cost_usd * i.fx_rate * i.landed_mult * i.markup
  return Math.ceil(raw / i.round_step) * i.round_step
}
