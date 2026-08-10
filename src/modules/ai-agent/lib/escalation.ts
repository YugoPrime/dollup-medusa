/**
 * Words that mean "a human handles this", whatever the model concluded.
 * French, English and Kreol together, because Doll Up's customers mix all three
 * in a single sentence.
 *
 * Each pair is [canonical spelling for the audit trail, accent-stripped form to
 * match on].
 *
 * Deliberately NOT single words when a single word is also common fashion
 * vocabulary: "cassé" collides with "blanc cassé" (off-white, a routine
 * colour question) so it is dropped entirely — "abîmé" and "damaged" already
 * cover damage claims without that collision. "avocat" collides with
 * "couleur avocat" (avocado green) so it is narrowed to the phrasings someone
 * actually uses when threatening legal action. This trades recall for fewer
 * false escalations on ordinary questions; the model's own escalation tool is
 * the backstop for anything phrased unusually.
 */
const HARD_TRIGGERS: Array<[canonical: string, normalized: string]> = [
  ["refund", "refund"],
  ["remboursement", "remboursement"],
  ["rembourser", "rembourser"],
  ["complaint", "complaint"],
  ["plainte", "plainte"],
  ["damaged", "damaged"],
  ["abîmé", "abime"],
  ["lawyer", "lawyer"],
  ["mon avocat", "mon avocat"],
  ["un avocat", "un avocat"],
  ["scam", "scam"],
  ["arnaque", "arnaque"],
  ["police", "police"],
]

/**
 * Lowercase and strip combining accents so "ABIME", "abimé" and "abîmé" all match
 * the same entry. \u0300-\u036f is the Unicode combining-diacritical-marks block,
 * which NFD decomposition separates out from the base letters.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/** Returns the canonical trigger word, or null when nothing matches. */
export function matchesHardTrigger(text: string): string | null {
  if (typeof text !== "string" || !text) return null
  const hay = normalize(text)
  for (const [canonical, normalized] of HARD_TRIGGERS) {
    if (hay.includes(normalized)) return canonical
  }
  return null
}

/**
 * Decides whether the conversation goes to a human instead of the customer
 * getting the model's reply.
 *
 * Order is deliberate: an errored run has no trustworthy output at all, so it is
 * checked before anything that reads the model's own claims about itself.
 */
export function shouldEscalate(input: {
  confidence: number | null
  threshold: number
  toolEscalated: boolean
  hardTrigger: string | null
  errored: boolean
}): { escalate: boolean; reason: string | null } {
  if (input.errored) return { escalate: true, reason: "agent_error" }
  if (input.toolEscalated) return { escalate: true, reason: "model_requested" }
  if (input.hardTrigger) {
    return { escalate: true, reason: `hard_trigger:${input.hardTrigger}` }
  }
  if (input.confidence === null || input.confidence < input.threshold) {
    return { escalate: true, reason: "low_confidence" }
  }
  return { escalate: false, reason: null }
}
