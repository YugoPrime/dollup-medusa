export type ImageKind =
  | "front"
  | "back"
  | "real"
  | "detail"
  | "size_chart"
  | "cutout"
  | "other"

// Accepts both the legacy short form (`-b`, `-r`, `-1`, `-s`) and the current
// long form (`-back`, `-real`, `-detail`, `-sizechart`, `-size-chart`). All
// production uploads use the long form; short form remains supported so older
// products that haven't been re-uploaded still classify correctly.
const ROLE_SUFFIX: Record<string, Exclude<ImageKind, "other">> = {
  // Short form (legacy)
  b: "back",
  r: "real",
  "1": "detail",
  s: "size_chart",
  cutout: "cutout",
  // Long form (current convention)
  front: "front",
  back: "back",
  real: "real",
  detail: "detail",
  sizechart: "size_chart",
}

// When the last 2 tokens joined match one of these, classify accordingly.
// Catches multi-word suffixes like `-size-chart` that the split-by-dash would
// otherwise see as just "chart".
const ROLE_SUFFIX_2TOKEN: Record<string, Exclude<ImageKind, "other">> = {
  "size-chart": "size_chart",
}

const SUPPORTED_EXT = /\.(jpe?g|png|webp|avif)$/i

/**
 * Pure function. Maps an R2/Medusa product image URL to a role by the boutique's
 * filename convention. Both naming styles are supported:
 *
 *   Legacy short form (older uploads):
 *     {Ref}.jpg          → front
 *     *-b.jpg            → back
 *     *-r.jpg            → real / on-model
 *     *-1.jpg            → detail / closeup
 *     *-s.jpg            → size chart
 *     *-cutout.png       → cutout
 *
 *   Current long form (all new uploads from 2026 onwards):
 *     *-front.jpg        → front
 *     *-back.jpg         → back
 *     *-real.jpg         → real / on-model
 *     *-detail.jpg       → detail / closeup
 *     *-sizechart.jpg    → size chart
 *     *-size-chart.jpg   → size chart (multi-word)
 *     *-cutout.png       → cutout
 *
 *   Anything else        → other
 *
 * The picker uses this to keep real/detail/size_chart out of product story
 * templates. Inputs without a recognized image extension classify as "other"
 * — they shouldn't be in the snapshot in the first place, but we don't want
 * to crash on them.
 */
export function classifyImageKind(url: string): ImageKind {
  if (!url) return "other"

  // Strip query/fragment so "...-r.jpg?v=2" still classifies as real
  const clean = url.split("?")[0].split("#")[0]

  if (!SUPPORTED_EXT.test(clean)) return "other"

  // Pull the filename without extension, then split on "-"
  const basename = clean.substring(clean.lastIndexOf("/") + 1)
  const noExt = basename.replace(SUPPORTED_EXT, "")
  const tokens = noExt.split("-")

  if (tokens.length < 2) return "front"

  // Two-token suffix check first (e.g. `-size-chart`) so it wins over the
  // single-token match on just "chart".
  if (tokens.length >= 3) {
    const last2 = `${tokens[tokens.length - 2]}-${tokens[tokens.length - 1]}`.toLowerCase()
    const role2 = ROLE_SUFFIX_2TOKEN[last2]
    if (role2) return role2
  }

  const last = tokens[tokens.length - 1].toLowerCase()
  const role = ROLE_SUFFIX[last]
  if (role) return role
  // Pure-digit trailing tokens (e.g. "-2", "-3") are almost certainly
  // off-convention detail/numbered shots — keep them out of product templates.
  if (/^\d+$/.test(last)) return "other"
  return "front"
}
