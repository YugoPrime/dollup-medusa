export const BUDGET_ALERT_FRACTION = 0.7

/** UTC year-month. Spend resets when this changes. */
export function currentPeriod(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}

export type SpendSettingsLike = {
  monthly_budget_usd_micros: number
  spend_usd_micros: number
  spend_period: string
  budget_alert_sent_at: Date | string | null
}

export type SpendUpdate = {
  spend_usd_micros: number
  spend_period: string
  /** True when the stored period was stale and the total restarted from zero. */
  rolled: boolean
  /** True when the alert flag should be cleared (a new period began). */
  clearAlert: boolean
  /** True on the single run that takes spend across 70% of the budget. */
  crossed70: boolean
  /** True once spend has reached or passed the ceiling. */
  exhausted: boolean
}

/**
 * Pure budget arithmetic. Extracted from the service so the logic that decides
 * when the shop stops paying for an LLM is testable without a database.
 *
 * Rollover is handled on read-and-write rather than by a cron, so the counter is
 * always correct even after a month with no traffic.
 */
export function computeSpendUpdate(input: {
  settings: SpendSettingsLike
  micros: number
  now?: Date
}): SpendUpdate {
  const now = input.now ?? new Date()
  const period = currentPeriod(now)
  const rolled = input.settings.spend_period !== period

  const storedRaw = Number(input.settings.spend_usd_micros)
  const stored = Number.isFinite(storedRaw) && storedRaw > 0 ? storedRaw : 0
  const before = rolled ? 0 : stored

  const addRaw = Number(input.micros)
  const add = Number.isFinite(addRaw) && addRaw > 0 ? Math.round(addRaw) : 0
  const after = before + add

  const budget = Number(input.settings.monthly_budget_usd_micros) || 0
  const threshold = budget * BUDGET_ALERT_FRACTION

  // After a rollover the previous period's alert no longer applies, so a run
  // that both rolls the period AND crosses 70% must still alert.
  const alreadyAlerted = rolled ? false : input.settings.budget_alert_sent_at != null
  const crossed70 = !alreadyAlerted && before < threshold && after >= threshold

  return {
    spend_usd_micros: after,
    spend_period: period,
    rolled,
    clearAlert: rolled,
    crossed70,
    exhausted: budget > 0 && after >= budget,
  }
}
