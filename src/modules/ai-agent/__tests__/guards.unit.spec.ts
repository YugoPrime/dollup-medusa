import { evaluateGuards } from "../lib/guards"
import { matchesHardTrigger, shouldEscalate } from "../lib/escalation"

const NOW = new Date("2026-08-10T12:00:00Z")

function settings(over: Record<string, unknown> = {}) {
  return {
    enabled: true,
    mode: "auto" as const,
    channels_enabled: { web: true, messenger: false, instagram: false, whatsapp: false },
    monthly_budget_usd_micros: 22_000_000,
    spend_usd_micros: 0,
    spend_period: "2026-08",
    ...over,
  }
}

const thread = { channel: "web", ai_paused_until: null }
const message = { direction: "inbound", sender_kind: "customer", body: "hi" }

describe("evaluateGuards", () => {
  it("runs when every gate is open", () => {
    expect(evaluateGuards({ settings: settings(), thread, message, now: NOW })).toEqual({
      run: true,
    })
  })

  it("skips when the master switch is off", () => {
    expect(
      evaluateGuards({ settings: settings({ enabled: false }), thread, message, now: NOW }),
    ).toEqual({ run: false, skipReason: "disabled" })
  })

  it("skips when this channel is off", () => {
    expect(
      evaluateGuards({
        settings: settings({
          channels_enabled: { web: false, messenger: false, instagram: false, whatsapp: false },
        }),
        thread,
        message,
        now: NOW,
      }),
    ).toEqual({ run: false, skipReason: "channel_off" })
  })

  it("skips a channel that has no entry at all", () => {
    expect(
      evaluateGuards({
        settings: settings(),
        thread: { channel: "instagram", ai_paused_until: null },
        message,
        now: NOW,
      }),
    ).toEqual({ run: false, skipReason: "channel_off" })
  })

  it("skips while a human holds the thread", () => {
    expect(
      evaluateGuards({
        settings: settings(),
        thread: { channel: "web", ai_paused_until: new Date("2026-08-10T18:00:00Z") },
        message,
        now: NOW,
      }),
    ).toEqual({ run: false, skipReason: "thread_paused" })
  })

  it("runs again once the takeover pause has expired", () => {
    expect(
      evaluateGuards({
        settings: settings(),
        thread: { channel: "web", ai_paused_until: new Date("2026-08-10T06:00:00Z") },
        message,
        now: NOW,
      }),
    ).toEqual({ run: true })
  })

  it("accepts an ISO string for the pause, not just a Date", () => {
    expect(
      evaluateGuards({
        settings: settings(),
        thread: { channel: "web", ai_paused_until: "2026-08-10T18:00:00.000Z" },
        message,
        now: NOW,
      }),
    ).toEqual({ run: false, skipReason: "thread_paused" })
  })

  it("skips when the budget is exhausted", () => {
    expect(
      evaluateGuards({
        settings: settings({ spend_usd_micros: 22_000_000 }),
        thread,
        message,
        now: NOW,
      }),
    ).toEqual({ run: false, skipReason: "over_budget" })
  })

  it("ignores spend recorded in a previous period", () => {
    expect(
      evaluateGuards({
        settings: settings({ spend_usd_micros: 99_000_000, spend_period: "1999-01" }),
        thread,
        message,
        now: NOW,
      }),
    ).toEqual({ run: true })
  })

  it("skips the agent's own outbound messages — no self-reply loop", () => {
    expect(
      evaluateGuards({
        settings: settings(),
        thread,
        message: { direction: "outbound", sender_kind: "ai", body: "…" },
        now: NOW,
      }),
    ).toEqual({ run: false, skipReason: "not_customer_message" })
  })

  it("skips a staff message", () => {
    expect(
      evaluateGuards({
        settings: settings(),
        thread,
        message: { direction: "outbound", sender_kind: "staff", body: "…" },
        now: NOW,
      }),
    ).toEqual({ run: false, skipReason: "not_customer_message" })
  })

  it("reports the most specific reason when several gates are shut", () => {
    expect(
      evaluateGuards({
        settings: settings({ enabled: false, spend_usd_micros: 99_000_000 }),
        thread,
        message,
        now: NOW,
      }).skipReason,
    ).toBe("disabled")
  })

  it("runs in shadow mode — shadow suppresses sending, not the run itself", () => {
    expect(
      evaluateGuards({ settings: settings({ mode: "shadow" }), thread, message, now: NOW }),
    ).toEqual({ run: true })
  })

  it("reports not_customer_message even when the budget is also exhausted", () => {
    expect(
      evaluateGuards({
        settings: settings({ spend_usd_micros: 22_000_000 }),
        thread,
        message: { direction: "outbound", sender_kind: "ai", body: "…" },
        now: NOW,
      }),
    ).toEqual({ run: false, skipReason: "not_customer_message" })
  })
})

describe("matchesHardTrigger", () => {
  it.each([
    ["je veux un remboursement", "remboursement"],
    ["I want a refund please", "refund"],
    ["this is a SCAM", "scam"],
    ["la robe est arrivée abîmée", "abîmé"],
    ["je vais contacter mon avocat", "mon avocat"],
    ["c'est une arnaque", "arnaque"],
  ])("matches %s", (text, expected) => {
    expect(matchesHardTrigger(text)).toBe(expected)
  })

  it("is accent-insensitive", () => {
    expect(matchesHardTrigger("ABIME")).toBe("abîmé")
    expect(matchesHardTrigger("abime")).toBe("abîmé")
  })

  it("does not fire on ordinary shopping questions", () => {
    expect(matchesHardTrigger("avez-vous cette robe en 38 ?")).toBeNull()
    expect(matchesHardTrigger("combien pour la livraison ?")).toBeNull()
    expect(matchesHardTrigger("ki pri sa robe la ?")).toBeNull()
    expect(matchesHardTrigger("bonjour")).toBeNull()
  })

  it("does not fire on 'blanc cassé' (off-white) — a colour question, not a damage claim", () => {
    expect(matchesHardTrigger("avez-vous cette robe en blanc cassé ?")).toBeNull()
  })

  it("does not fire on 'couleur avocat' (avocado green) — a colour question, not a legal threat", () => {
    expect(matchesHardTrigger("je cherche un sac couleur avocat")).toBeNull()
  })

  it("still fires on 'mon avocat' when someone actually means a lawyer", () => {
    expect(matchesHardTrigger("je vais contacter mon avocat")).toBe("mon avocat")
  })

  it("regression guard: damage claims still escalate after the 'cassé' entry was removed", () => {
    expect(matchesHardTrigger("la robe est arrivée abîmée")).toBe("abîmé")
  })

  it("handles empty and non-string input without throwing", () => {
    expect(matchesHardTrigger("")).toBeNull()
    expect(matchesHardTrigger(null as never)).toBeNull()
    expect(matchesHardTrigger(undefined as never)).toBeNull()
  })
})

describe("shouldEscalate", () => {
  it("escalates on an agent error, whatever else is true", () => {
    expect(
      shouldEscalate({
        confidence: 0.99,
        threshold: 0.7,
        toolEscalated: false,
        hardTrigger: null,
        errored: true,
      }),
    ).toEqual({ escalate: true, reason: "agent_error" })
  })

  it("escalates when the model asked to", () => {
    expect(
      shouldEscalate({
        confidence: 0.99,
        threshold: 0.7,
        toolEscalated: true,
        hardTrigger: null,
        errored: false,
      }),
    ).toEqual({ escalate: true, reason: "model_requested" })
  })

  it("escalates on a hard trigger even at high confidence", () => {
    expect(
      shouldEscalate({
        confidence: 0.99,
        threshold: 0.7,
        toolEscalated: false,
        hardTrigger: "remboursement",
        errored: false,
      }),
    ).toEqual({ escalate: true, reason: "hard_trigger:remboursement" })
  })

  it("escalates below the confidence threshold", () => {
    expect(
      shouldEscalate({
        confidence: 0.5,
        threshold: 0.7,
        toolEscalated: false,
        hardTrigger: null,
        errored: false,
      }),
    ).toEqual({ escalate: true, reason: "low_confidence" })
  })

  it("escalates when confidence is missing entirely", () => {
    expect(
      shouldEscalate({
        confidence: null,
        threshold: 0.7,
        toolEscalated: false,
        hardTrigger: null,
        errored: false,
      }),
    ).toEqual({ escalate: true, reason: "low_confidence" })
  })

  it("does not escalate exactly at the threshold", () => {
    expect(
      shouldEscalate({
        confidence: 0.7,
        threshold: 0.7,
        toolEscalated: false,
        hardTrigger: null,
        errored: false,
      }),
    ).toEqual({ escalate: false, reason: null })
  })

  it("does not escalate a confident ordinary answer", () => {
    expect(
      shouldEscalate({
        confidence: 0.9,
        threshold: 0.7,
        toolEscalated: false,
        hardTrigger: null,
        errored: false,
      }),
    ).toEqual({ escalate: false, reason: null })
  })
})
