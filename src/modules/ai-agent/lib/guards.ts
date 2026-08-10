import { currentPeriod } from "./spend"

export type SkipReason =
  | "disabled"
  | "channel_off"
  | "thread_paused"
  | "over_budget"
  | "not_customer_message"

type GuardInput = {
  settings: {
    enabled: boolean
    mode: "shadow" | "auto"
    channels_enabled: Record<string, boolean>
    monthly_budget_usd_micros: number
    spend_usd_micros: number
    spend_period: string
  }
  thread: { channel: string; ai_paused_until?: Date | string | null }
  message: { direction: string; sender_kind: string; body?: string | null }
  now: Date
}

/**
 * Decides whether the agent runs at all, before any token is spent.
 *
 * Ordered most-specific-first so the recorded skip_reason names the real cause
 * rather than whichever gate happened to be checked first.
 *
 * Deliberately does NOT gate on `mode`: shadow mode still runs the agent, it just
 * doesn't send the reply. That is the entire point of shadow mode — a week of
 * real drafts to review before anything reaches a customer.
 */
export function evaluateGuards(input: GuardInput): { run: boolean; skipReason?: SkipReason } {
  const { settings, thread, message, now } = input

  if (!settings.enabled) return { run: false, skipReason: "disabled" }

  if (!settings.channels_enabled?.[thread.channel]) {
    return { run: false, skipReason: "channel_off" }
  }

  if (thread.ai_paused_until) {
    const until = new Date(thread.ai_paused_until).getTime()
    if (Number.isFinite(until) && until > now.getTime()) {
      return { run: false, skipReason: "thread_paused" }
    }
  }

  // Spend from an earlier month is stale — it rolls over on the next write.
  const spend =
    settings.spend_period === currentPeriod(now) ? Number(settings.spend_usd_micros ?? 0) : 0
  if (spend >= Number(settings.monthly_budget_usd_micros ?? 0)) {
    return { run: false, skipReason: "over_budget" }
  }

  if (message.direction !== "inbound" || message.sender_kind !== "customer") {
    return { run: false, skipReason: "not_customer_message" }
  }

  return { run: true }
}
