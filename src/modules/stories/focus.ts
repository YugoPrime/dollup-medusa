/**
 * "New collection focus": while a focus tag is set (and today is on or before
 * `focus_until`), the story picker and the grid planner put products carrying
 * that Medusa tag first. Dates are Mauritius calendar dates ("YYYY-MM-DD"),
 * compared as strings; `focus_until` is inclusive and null means no end.
 */

const TAG_RE = /^[a-z0-9_-]{1,64}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type FocusSettings = {
  focus_tag?: string | null
  focus_until?: string | null
}

/** The lowercased focus tag active on `date`, or null when focus is off. */
export function activeFocusTag(s: FocusSettings, date: string): string | null {
  const tag = (s.focus_tag ?? "").trim().toLowerCase()
  if (!tag) return null
  if (s.focus_until && date > s.focus_until) return null
  return tag
}

/** True when the product carries `tag` (case-insensitive, trimmed). */
export function hasTag(p: { tags?: string[] }, tag: string): boolean {
  const want = tag.trim().toLowerCase()
  return (p.tags ?? []).some((t) => t.trim().toLowerCase() === want)
}

/** How many products carry `tag` and still have at least one variant in stock. */
export function countEligibleFocus(
  products: Array<{ tags?: string[]; variants: Array<{ inventory_quantity: number }> }>,
  tag: string,
): number {
  return products.filter(
    (p) => hasTag(p, tag) && p.variants.some((v) => v.inventory_quantity > 0),
  ).length
}

/**
 * Validates the focus fields of a settings update. Keys absent from `body` are
 * absent from the result; "" or null turns a field off. Throws on bad input
 * (the settings route maps the error to a 400).
 */
export function parseFocusSettingsInput(
  body: Record<string, unknown>,
): { focus_tag?: string | null; focus_until?: string | null } {
  const out: { focus_tag?: string | null; focus_until?: string | null } = {}

  if ("focus_tag" in body) {
    const raw = body.focus_tag
    const tag = typeof raw === "string" ? raw.trim() : ""
    if (raw != null && typeof raw !== "string") {
      throw new Error("focus_tag must be letters, digits, - or _")
    }
    if (tag && !TAG_RE.test(tag)) {
      throw new Error("focus_tag must be letters, digits, - or _")
    }
    out.focus_tag = tag || null
  }

  if ("focus_until" in body) {
    const raw = body.focus_until
    const date = typeof raw === "string" ? raw.trim() : ""
    if (raw != null && typeof raw !== "string") {
      throw new Error("focus_until must be YYYY-MM-DD")
    }
    if (date && !DATE_RE.test(date)) {
      throw new Error("focus_until must be YYYY-MM-DD")
    }
    out.focus_until = date || null
  }

  return out
}

/**
 * Whether a settings read asked for focus stats (`?stats=1`). Counting needs a
 * full catalog pass, so only the Settings page asks; the daily-use story pages
 * read settings without it.
 */
export function wantsFocusStats(query: Record<string, unknown>): boolean {
  return query.stats === "1" || query.stats === "true"
}
