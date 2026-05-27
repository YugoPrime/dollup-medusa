/**
 * Pure SHEIN PDP parser. Two responsibilities:
 *
 *  1. extractJsonLd(html) — pulls the <script id="goodsDetailSchema"> JSON-LD
 *     ProductGroup. That gives us title, single-color name, full image list,
 *     and per-variant size + price + availability. Source of truth for each
 *     SHEIN URL we crawl (parent OR sibling).
 *
 *  2. extractSiblingColors(html) — scans inline <script> blocks for the
 *     mainSaleAttribute.info[] entries. Each entry is a sibling color
 *     (different goods_id) with a usable URL slug. Used to discover all
 *     colors of a multi-color product from the page where the bookmarklet
 *     was clicked.
 *
 * No DOM dependency. Pure string-in / object-out so it's testable in Node
 * and reusable by the daily availability cron.
 */

export type SheinJsonLdVariant = {
  sku: string
  size: string
  offers: {
    price: string
    priceCurrency: string
    availability: string // "https://schema.org/InStock" | "OutOfStock"
  }
}

export type SheinJsonLd = {
  name: string
  color: string
  productGroupID: string
  image: string[]
  hasVariant: SheinJsonLdVariant[]
}

export type SheinSiblingColor = {
  color_name: string
  goods_id: string
  goods_url_name: string
  goods_color_image: string
  goods_image: string
}

const JSON_LD_REGEX =
  /<script[^>]+id=["']goodsDetailSchema["'][^>]*>([\s\S]*?)<\/script>/

const SHEIN_CDN = /^(https?:)?\/\/img\.ltwebstatic\.com\//
const ATTR_ID_27_MARKER = '"attr_id":"27"'

export function extractJsonLd(html: string): SheinJsonLd | null {
  const match = html.match(JSON_LD_REGEX)
  if (!match) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(match[1].trim())
  } catch {
    return null
  }
  const pg = Array.isArray(parsed) ? parsed[0] : parsed
  if (!isProductGroup(pg)) return null
  return normalizeProductGroup(pg)
}

export function extractSiblingColors(html: string): SheinSiblingColor[] {
  // mainSaleAttribute lives in an inline <script> (not the JSON-LD). We don't
  // know the script's exact start, so we scan for each color object directly:
  // each is identifiable by "attr_id":"27" (the Color attribute). For each
  // hit, balance braces backward to find the object start and forward to find
  // the object end, then JSON.parse it.
  const out: SheinSiblingColor[] = []
  const seen = new Set<string>()
  let pos = 0
  while (true) {
    const idx = html.indexOf(ATTR_ID_27_MARKER, pos)
    if (idx === -1) break
    pos = idx + 1
    const objBounds = findEnclosingObject(html, idx)
    if (!objBounds) continue
    let obj: any
    try {
      obj = JSON.parse(html.slice(objBounds.start, objBounds.end))
    } catch {
      continue
    }
    if (!isSiblingColor(obj)) continue
    if (seen.has(obj.goods_id)) continue
    seen.add(obj.goods_id)
    out.push({
      color_name: String(obj.attr_value),
      goods_id: String(obj.goods_id),
      goods_url_name: String(obj.goods_url_name),
      goods_color_image: String(obj.goods_color_image ?? ""),
      goods_image: String(obj.goods_image ?? ""),
    })
  }
  return out
}

export function buildSiblingUrl(entry: SheinSiblingColor): string {
  const slug = entry.goods_url_name.trim().replace(/\s+/g, "-")
  return `https://www.shein.com/${slug}-p-${entry.goods_id}.html`
}

// -- helpers -------------------------------------------------------------

function isProductGroup(v: unknown): v is Record<string, any> {
  return (
    !!v &&
    typeof v === "object" &&
    (v as any)["@type"] === "ProductGroup" &&
    typeof (v as any).name === "string"
  )
}

function normalizeProductGroup(pg: Record<string, any>): SheinJsonLd {
  const images: string[] = Array.isArray(pg.image)
    ? pg.image.filter(
        (u: unknown): u is string => typeof u === "string" && SHEIN_CDN.test(u),
      )
    : typeof pg.image === "string" && SHEIN_CDN.test(pg.image)
      ? [pg.image]
      : []
  const variants: SheinJsonLdVariant[] = Array.isArray(pg.hasVariant)
    ? pg.hasVariant
        .filter(
          (v: any) =>
            v &&
            typeof v.size === "string" &&
            v.offers &&
            typeof v.offers.price === "string",
        )
        .map((v: any) => ({
          sku: String(v.sku ?? ""),
          size: String(v.size),
          offers: {
            price: String(v.offers.price),
            priceCurrency: String(v.offers.priceCurrency ?? "USD"),
            availability: String(
              v.offers.availability ?? "https://schema.org/InStock",
            ),
          },
        }))
    : []
  return {
    name: String(pg.name),
    color: typeof pg.color === "string" ? pg.color : "Default",
    productGroupID: String(pg.productGroupID ?? ""),
    image: images,
    hasVariant: variants,
  }
}

function isSiblingColor(v: unknown): v is Record<string, any> {
  return (
    !!v &&
    typeof v === "object" &&
    (v as any).attr_id === "27" &&
    typeof (v as any).attr_value === "string" &&
    typeof (v as any).goods_id === "string" &&
    typeof (v as any).goods_url_name === "string"
  )
}

function findEnclosingObject(
  html: string,
  innerIdx: number,
): { start: number; end: number } | null {
  // Scanning backward through arbitrary JS source can't reliably pair string
  // quotes (you can't tell from a single `"` whether it opens or closes a
  // string). Instead: walk backward through candidate `{` positions and, for
  // each, parse FORWARD with a proper string-state machine. The first
  // candidate whose balanced-object range contains innerIdx is the enclosing
  // object. Forward parsing handles strings correctly because we always start
  // outside a string at the `{`.
  for (let i = innerIdx; i >= 0; i--) {
    if (html[i] !== "{") continue
    const bounds = parseObjectForward(html, i)
    if (!bounds) continue
    if (bounds.start <= innerIdx && bounds.end > innerIdx) {
      return bounds
    }
  }
  return null
}

function parseObjectForward(
  html: string,
  start: number,
): { start: number; end: number } | null {
  if (html[start] !== "{") return null
  let depth = 0
  let inString = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inString) {
      if (c === "\\") {
        // Skip the next char — it's an escaped char inside the string.
        i++
        continue
      }
      if (c === '"') {
        inString = false
      }
      continue
    }
    if (c === '"') {
      inString = true
      continue
    }
    if (c === "{") {
      depth++
    } else if (c === "}") {
      depth--
      if (depth === 0) return { start, end: i + 1 }
    }
  }
  return null
}
