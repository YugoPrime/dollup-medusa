export type ImageKind =
  | "front"
  | "back"
  | "real"
  | "detail"
  | "size_chart"
  | "other"

const ROLE_SUFFIX: Record<string, Exclude<ImageKind, "front" | "other">> = {
  b: "back",
  r: "real",
  "1": "detail",
  s: "size_chart",
}

const SUPPORTED_EXT = /\.(jpe?g|png|webp|avif)$/i

/**
 * Pure function. Maps an R2/Medusa product image URL to a role by the boutique's
 * filename convention:
 *   {Ref}.jpg                → front
 *   {Ref}-{color}.jpg        → front (color is just a color name, not a role)
 *   *-b.jpg                  → back
 *   *-r.jpg                  → real / on-model
 *   *-1.jpg                  → detail / closeup
 *   *-s.jpg                  → size chart
 *   anything else            → other
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

  const last = tokens[tokens.length - 1].toLowerCase()
  const role = ROLE_SUFFIX[last]
  if (role) return role
  // Pure-digit trailing tokens (e.g. "-2", "-3") are almost certainly
  // off-convention detail/numbered shots — keep them out of product templates.
  if (/^\d+$/.test(last)) return "other"
  return "front"
}
