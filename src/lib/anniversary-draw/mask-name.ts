/**
 * Masks a customer name for public display on the anniversary draw wall.
 *
 * The output is rendered as text on a public page, so this is a security
 * boundary as much as a privacy one: a customer can type anything into the
 * checkout name field, and none of it may reach the wall verbatim.
 *
 * Order of preference: name fields → email prefix → generic label.
 *
 * ⚠️ THE RULE IS POSITIONAL, NOT FIELD-BASED. Do not "simplify" this back into
 * `first + lastName[0]`. On 2026-07-17 the wall went live publishing FULL
 * customer surnames ("Hashna Dhula", "Kate Meunier") because the original
 * implementation trusted the checkout's field split: it masked only when
 * `last_name` was populated, and fell through to printing `first_name` verbatim
 * otherwise. In real Doll Up checkout data a large share of customers type
 * their WHOLE name into the first-name box and leave last-name empty, so that
 * branch published the surname of 4 of the first 6 orders.
 *
 * So: concatenate whatever name fields exist, split into words, and mask by
 * POSITION — first word in full, last word reduced to an initial. Where the
 * words came from is irrelevant and must stay irrelevant.
 */

const GENERIC = "Doll Up client"
/** Long enough for "Marie-Claire D."; short enough not to blow out a bubble. */
const MAX_LEN = 18

/** Letters (incl. accented), space, hyphen, apostrophe. Everything else goes. */
const DISALLOWED = /[^\p{L} '-]/gu

function clean(input: string | null | undefined): string {
  if (!input) return ""
  return input.replace(DISALLOWED, "").replace(/\s+/g, " ").trim()
}

function titleCase(input: string): string {
  // Capitalize after a start, space, hyphen or apostrophe: "marie-claire" -> "Marie-Claire".
  return input
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
}

/**
 * The single masking rule, applied to a list of name words regardless of which
 * field they came from: first word in full, last word as an initial.
 * ["Hashna","Dhula"] -> "Hashna D."   ["Rahvi"] -> "Rahvi"
 */
function maskWords(words: string[]): string {
  if (words.length === 0) return ""
  if (words.length === 1) return words[0]
  const first = words[0]
  const surname = words[words.length - 1]
  return `${first} ${surname[0]}.`
}

export function maskName(input: {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
}): string {
  // Concatenate the name fields FIRST, then mask by word position. Never branch
  // on which field was populated — see the header comment.
  const nameWords = titleCase(clean(`${input.firstName ?? ""} ${input.lastName ?? ""}`))
    .split(" ")
    .filter(Boolean)

  let out = maskWords(nameWords)

  if (!out) {
    // Email fallback. Drop any "+tag" before splitting, so "jean+promo@x.com"
    // doesn't turn the tag into the surname position.
    const prefix = (input.email ?? "").split("@")[0]?.split("+")[0] ?? ""
    const words = prefix
      .split(/[._-]+/)
      .map((w) => titleCase(clean(w)))
      .filter(Boolean)
    out = maskWords(words)
  }

  if (!out) return GENERIC

  if (out.length > MAX_LEN) {
    out = out.slice(0, MAX_LEN)
    // Truncation can leave "Alexandrinaa S" or "Alexandrina S." mid-initial;
    // drop any trailing separator/orphaned initial so it reads cleanly.
    out = out.replace(/[\s'-]+\p{L}?\.?$/u, "").replace(/[\s'-]+$/u, "")
  }

  return out || GENERIC
}
