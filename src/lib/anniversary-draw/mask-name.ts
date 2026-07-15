/**
 * Masks a customer name for public display on the anniversary draw wall.
 *
 * The output is rendered as text on a public page, so this is a security
 * boundary as much as a privacy one: a customer can type anything into the
 * checkout name field, and none of it may reach the wall verbatim.
 *
 * Order of preference: "Rahvi B." → "Rahvi" → email prefix → generic label.
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

function fromEmail(email: string | null | undefined): string {
  if (!email) return ""
  const prefix = email.split("@")[0] ?? ""
  // Split on dots/underscores so "rahvi.b99" -> "Rahvi B", not "Rahvib".
  const words = prefix
    .split(/[._+-]+/)
    .map((w) => clean(w))
    .filter(Boolean)
  return words.join(" ")
}

export function maskName(input: {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
}): string {
  const first = titleCase(clean(input.firstName))
  const last = titleCase(clean(input.lastName))

  let out = ""
  if (first && last) {
    out = `${first} ${last[0]}.`
  } else if (first) {
    out = first
  } else {
    out = titleCase(fromEmail(input.email))
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
