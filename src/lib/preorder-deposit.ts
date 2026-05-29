export type DepositBreakdown = { total: number; deposit: number; balance: number }

const DEPOSIT_RATE = 0.75
const ROUND_TO = 50

export function computeDeposit(itemTotal: number, shippingTotal: number): DepositBreakdown {
  const total = Math.max(0, Math.round(itemTotal) + Math.round(shippingTotal))
  const deposit = Math.min(total, Math.ceil((total * DEPOSIT_RATE) / ROUND_TO) * ROUND_TO)
  return { total, deposit, balance: total - deposit }
}
