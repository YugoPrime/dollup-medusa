/**
 * The daily next-day-delivery cutoff.
 *
 * The cutoff moves day to day because it tracks whatever time the courier
 * actually comes for pickup — usually noon, sometimes 1pm, occasionally later.
 * It used to be hardcoded, which is how the site ended up publishing three
 * different times at once (2pm on the FAQ, noon in the ETA copy, and 1pm
 * actually enforced at checkout).
 *
 * One stored value now drives all of them. The owner is asked at noon — the
 * moment the default cutoff falls — whether to close there or push later.
 *
 * Asking at noon works because every offerable hour is noon or later: an order
 * placed before noon qualifies for next-day delivery under any of them, so a
 * value left over from yesterday cannot give a wrong answer during the morning.
 * It only starts to matter at 12:00, which is exactly when the job resets it to
 * the default and asks. Silence therefore means noon; a tap extends the day.
 */

/** Mauritius is a fixed UTC+4 with no DST. */
export const MU_OFFSET_MS = 4 * 60 * 60 * 1000

/** Applies whenever nobody answers the morning prompt. */
export const DEFAULT_CUTOFF_HOUR = 12

/**
 * Offerable cutoffs, as whole hours in Mauritius time. Buttons, not free text:
 * one tap on a phone, nothing to parse, and impossible to set a value the rest
 * of the system would reject.
 */
export const CUTOFF_CHOICES = [12, 13, 14, 15] as const

export type CutoffHour = (typeof CUTOFF_CHOICES)[number]

export function isCutoffChoice(value: unknown): value is CutoffHour {
  return (CUTOFF_CHOICES as readonly unknown[]).includes(value)
}

/**
 * Coerce a stored or supplied hour into an offerable one, falling back to the
 * default. Guards the read path: a hand-edited database row or an out-of-range
 * value must never widen the delivery promise beyond what the courier can meet.
 */
export function normalizeCutoffHour(value: unknown): CutoffHour {
  const n = Math.trunc(Number(value))
  return isCutoffChoice(n) ? n : DEFAULT_CUTOFF_HOUR
}

/** "noon", "1pm", "3pm" — how the cutoff is written to customers. */
export function formatCutoffEn(hour: number): string {
  const h = normalizeCutoffHour(hour)
  if (h === 12) return "noon"
  return `${h - 12}pm`
}

/** "midi", "13h" — the French form, for the concierge's knowledge base. */
export function formatCutoffFr(hour: number): string {
  const h = normalizeCutoffHour(hour)
  return h === 12 ? "midi" : `${h}h`
}

/**
 * The one customer-facing sentence, generated rather than typed. Rendered on the
 * shipping page and the product accordion, so it can never disagree with what
 * checkout enforces.
 */
export function buildEtaCopy(hour: number): string {
  return `Order before ${formatCutoffEn(hour)} for next-day delivery across Mauritius.`
}

/** Same sentence for the concierge, including the Friday rule. */
export function buildEtaCopyFr(hour: number): string {
  const label = formatCutoffFr(hour)
  return (
    `Les articles en stock partent le lendemain si la commande est passée avant ${label}. ` +
    `Passé ${label} le vendredi, la livraison se fait le lundi — nous ne livrons pas le dimanche.`
  )
}

/** Telegram callback payloads are opaque strings, so namespace ours. */
const CALLBACK_PREFIX = "cutoff:"

export function buildCallbackData(hour: CutoffHour): string {
  return `${CALLBACK_PREFIX}${hour}`
}

/**
 * Read an hour back out of a callback payload. Returns null for anything that
 * isn't one of our buttons — Telegram will happily deliver callbacks from other
 * keyboards, and an old message's button can be tapped days later.
 */
export function parseCallbackData(data: unknown): CutoffHour | null {
  if (typeof data !== "string" || !data.startsWith(CALLBACK_PREFIX)) return null
  const hour = Math.trunc(Number(data.slice(CALLBACK_PREFIX.length)))
  return isCutoffChoice(hour) ? hour : null
}

/** Mauritius calendar day for an instant, as YYYY-MM-DD. */
export function muDay(now: Date = new Date()): string {
  return new Date(now.getTime() + MU_OFFSET_MS).toISOString().slice(0, 10)
}

/** 0 = Sunday … 5 = Friday, 6 = Saturday, in Mauritius time. */
export function muWeekday(now: Date = new Date()): number {
  return new Date(now.getTime() + MU_OFFSET_MS).getUTCDay()
}

export type CutoffPrompt = {
  text: string
  buttons: Array<{ text: string; callback_data: string }>
}

/** Button labels: the default reads as "leave it", the rest as an extension. */
function buttonLabel(hour: CutoffHour): string {
  return hour === DEFAULT_CUTOFF_HOUR
    ? `Keep ${formatCutoffEn(hour)}`
    : `Push to ${formatCutoffEn(hour)}`
}

/**
 * The noon message. It lands as the default cutoff falls, so it asks whether to
 * close there or extend — not to set a value in advance.
 *
 * Extending is retroactive by design: orders already placed before noon keep
 * their next-day delivery, and pushing to 2pm simply lets the next two hours of
 * orders qualify too. Nothing a customer was already promised is withdrawn.
 */
export function buildCutoffPrompt(now: Date = new Date()): CutoffPrompt {
  const friday = muWeekday(now) === 5
  const lines = [
    "🚚 <b>It's noon — cutoff time</b>",
    "",
    "Closing at <b>noon</b> unless you push it. Tap a later time if the driver is still coming.",
  ]
  if (friday) {
    lines.push("")
    lines.push("It's Friday — anything after the cutoff is delivered <b>Monday</b>.")
  }
  return {
    text: lines.join("\n"),
    buttons: CUTOFF_CHOICES.map((h) => ({
      text: buttonLabel(h),
      callback_data: buildCallbackData(h),
    })),
  }
}

/** Shown on the button tap, and appended to the message so the day has a record. */
export function buildCutoffConfirmation(hour: CutoffHour, now: Date = new Date()): string {
  const friday = muWeekday(now) === 5
  const label = formatCutoffEn(hour)
  const head =
    hour === DEFAULT_CUTOFF_HOUR
      ? `Closed at ${label}.`
      : `Cutoff pushed to ${label}.`
  return friday ? `${head} Anything later goes out Monday.` : head
}
