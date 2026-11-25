/**
 * Size labels for the daily grid post: the order customers read them in, and
 * which sizes belong on which photo.
 *
 * Order: XXS … 5XL (XXL = 2XL, XXXL = 3XL, each keeps its spelling), then the
 * combined sizes (S/M, L/XL …), then cups (A–F, DD), then numbers ascending,
 * then anything else A→Z. Every one-size spelling ("OS", "Free Size") shows as
 * "One size", last.
 */

const ONE_SIZE = "One size"
const ONE_SIZE_RE = /^(os|one[\s-]*size|free[\s-]*size)$/i

const LADDER: Record<string, number> = {
  XXS: 0,
  XS: 1,
  S: 2,
  M: 3,
  L: 4,
  XL: 5,
  XXL: 6,
  "2XL": 6,
  XXXL: 7,
  "3XL": 7,
  XXXXL: 8,
  "4XL": 8,
  "5XL": 9,
}

const CUP_RE = /^(A|B|C|D|DD|E|F)$/
const NUMBER_RE = /^\d+(\.\d+)?$/
/** Control, zero-width and other invisible characters: Pango can't draw a label made of them. */
// eslint-disable-next-line no-control-regex
const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g

type Rank = [band: number, sub: number]

function rankOf(label: string): Rank {
  if (label === ONE_SIZE) return [90, 0]
  const key = label.toUpperCase().replace(/\s+/g, "")
  if (key in LADDER) return [0, LADDER[key]]
  const combo = key.split("/")
  if (combo.length === 2 && combo[0] in LADDER && combo[1] in LADDER) {
    return [20, LADDER[combo[0]] * 10 + LADDER[combo[1]]]
  }
  if (CUP_RE.test(key)) return [40, key === "DD" ? 3.5 : key.charCodeAt(0) - 65]
  if (NUMBER_RE.test(key)) return [60, Number(key)]
  return [80, 0]
}

/** Deduped (case and spaces ignored, first spelling kept) and ordered small → large. */
export function sortSizes(sizes: string[]): string[] {
  const seen = new Map<string, string>()
  for (const raw of sizes) {
    const clean = String(raw ?? "").replace(INVISIBLE_RE, "").trim().replace(/\s+/g, " ")
    if (!clean) continue
    const label = ONE_SIZE_RE.test(clean) ? ONE_SIZE : clean
    const key = label.toLowerCase().replace(/\s+/g, "")
    if (!seen.has(key)) seen.set(key, label)
  }
  return [...seen.values()].sort((a, b) => {
    const [ba, sa] = rankOf(a)
    const [bb, sb] = rankOf(b)
    return ba - bb || sa - sb || a.localeCompare(b)
  })
}

type SnapshotLike = {
  variants_in_stock?: Array<{ sizes?: string[] | null; image_urls?: string[] | null }> | null
} | null | undefined

/**
 * The sizes to draw on one photo: the in-stock sizes of every colour whose
 * photos include it, or every in-stock size when no colour claims it.
 */
export function sizesForPhoto(snapshot: SnapshotLike, url: string): string[] {
  const variants = snapshot?.variants_in_stock ?? []
  const claimed = variants.filter((v) => (v.image_urls ?? []).includes(url))
  const pool = claimed.length > 0 ? claimed : variants
  return sortSizes(pool.flatMap((v) => v.sizes ?? []))
}
