import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import path from "node:path"
import sharp from "sharp"

import { type FeedPriceLabel, formatRs } from "./feed-price-label"
import { uploadPublicObject } from "./sourcing/r2-upload"

/**
 * Makes product photos postable on the Instagram grid.
 *
 * Instagram's publishing API only accepts JPEG, between 4:5 and 1.91:1 and at
 * least 320 px wide, and crops every carousel photo to the first photo's shape.
 * Product photos are often PNG or WebP (sometimes under a .png name), 3:4, or
 * small supplier screenshots. So before posting, every photo is redrawn as a
 * 1080x1350 (4:5) JPEG: the whole photo, centred on a blurred copy of itself,
 * never cropped. The copies go to R2 under `feed/`; the product keeps its photos.
 *
 * Each photo can also carry labels, in the look Rahvi picked for the collection
 * 30 catalogue photos on 2026-11-23 (`Ali30\IS2462-Red.jpg`):
 * - the product code in a dark pill with a thin gold edge, top right;
 * - the price in the serif, above
 * - the "SIZES" row (soft dark fade, gold line, gold label, cream chips).
 * Customers screenshot grid photos and send them in a DM, so code and price
 * are on every photo (Rahvi, 2026-11-25). No collection line: the grid runs on.
 */

export const FEED_IMAGE_WIDTH = 1080
export const FEED_IMAGE_HEIGHT = 1350
const JPEG_QUALITY = 88
const BACKDROP_BLUR = 40
/** Bump when the drawing changes, so cached copies on the CDN aren't reused. */
const KEY_VERSION = "v3"
const FETCH_TIMEOUT_MS = 30_000

/** Inter Medium. TTF, because the live image's libvips can't read WOFF2. */
export const FEED_FONT_FILE = path.resolve(process.cwd(), "src/assets/fonts/Inter-Medium.ttf")
const FONT_FAMILY = "Inter Medium"
const FALLBACK_FONT = "sans-serif"

/** Playfair Display (variable, OFL), the catalogue card's price font. Same TTF-only rule. */
export const SERIF_FONT_FILE = path.resolve(process.cwd(), "src/assets/fonts/PlayfairDisplay-VF.ttf")
type FontChoice = { family: string; file: string; fallback: string }
const SANS_FONT: FontChoice = { family: FONT_FAMILY, file: FEED_FONT_FILE, fallback: FALLBACK_FONT }
const SERIF_FONT: FontChoice = { family: "Playfair Display", file: SERIF_FONT_FILE, fallback: "serif" }

// The size row (approved mockup, 2026-11-25).
const INK = "#1A1212"
const GOLD = "#D4A853"
const GOLD_LIGHT = "#ECD6A0"
const CREAM = "#FDF8F7"
const WHITE = "#FFFFFF"
const CHIP_OPACITY = 0.92
/** Opacity rises as t^curve from the top of the fade to `max` at the bottom edge. */
const FADE_SIZES_ONLY = { height: 420, max: 0.78, curve: 1.3 }
/** The catalogue card's fade (640 px, 215/255): the price sits higher up. */
const FADE_WITH_PRICE = { height: 640, max: 0.84, curve: 1.2 }
const LABEL_LEFT = 56
const LABEL_PX = 28
const LABEL_SPACING_PX = 5
const GOLD_LINE = { left: 56, width: 100, y: FEED_IMAGE_HEIGHT - 166, thickness: 3 }
const CHIPS_LEFT = 210
const CHIPS_RIGHT_LIMIT = FEED_IMAGE_WIDTH - 30
/** Vertical centre of the (bottom) chip line: top H-136, 66 px high. */
const ROW_CENTRE_Y = FEED_IMAGE_HEIGHT - 136 + 33
const LINE_GAP = 12
const CHIP_STEPS = [
  { text: 34, height: 66, pad: 24, gap: 14 },
  { text: 30, height: 58, pad: 20, gap: 12 },
  { text: 26, height: 52, pad: 18, gap: 10 },
] as const

// The price (catalogue card: Playfair 700 at 104 px, ink ending 40 px above the gold line).
const PRICE_LEFT = 52
const PRICE_RIGHT_MARGIN = 44
const PRICE_PX_STEPS = [104, 92, 80] as const
/** "From" and the struck-through old price, relative to the price. */
const PRICE_SMALL_RATIO = 0.46
const PRICE_GAP_ABOVE_LINE = 40
const PRICE_GAP_ABOVE_CHIPS = 26
const PRICE_BOTTOM_NO_SIZES = 96
const SHADOW_BLUR = 10
const SHADOW_OPACITY = 0.55

// The code pill (catalogue card: 66 px high, 44 px from the corner, Inter 30, 2 px tracking).
const PILL = {
  margin: 44,
  height: 66,
  pad: 28,
  text: 30,
  spacing: 2,
  fillOpacity: 0.6,
  stroke: 2,
  strokeOpacity: 0.8,
}

/** What is printed on one photo. Each part is optional and drawn on its own. */
export type FeedPhotoLabels = {
  sizes?: string[]
  price?: FeedPriceLabel | null
  /** Product code for the top-right pill, e.g. "IS2462". */
  sku?: string | null
}

export async function normalizeFeedImage(input: Buffer, opts: FeedPhotoLabels = {}): Promise<Buffer> {
  // Transparent areas go white first, so the photo and its backdrop agree.
  const flat = await sharp(input).rotate().flatten({ background: "#ffffff" }).toBuffer()
  const backdrop = await sharp(flat)
    .resize(FEED_IMAGE_WIDTH, FEED_IMAGE_HEIGHT, { fit: "cover" })
    .blur(BACKDROP_BLUR)
    .toBuffer()
  const photo = await sharp(flat)
    .resize(FEED_IMAGE_WIDTH, FEED_IMAGE_HEIGHT, { fit: "inside" })
    .toBuffer()
  const framed = sharp(backdrop).composite([{ input: photo, gravity: "centre" }])

  const labels = cleanLabels(opts)
  if (labels.sizes.length === 0 && !labels.price && !labels.sku) {
    return framed.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
  }
  // sharp runs one composite per pipeline: settle the photo first, then draw the labels.
  const base = await framed.png().toBuffer()
  const plain = () => sharp(base).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
  try {
    const layers = await labelLayers(labels)
    if (layers.length === 0) return plain()
    return await sharp(base).composite(layers).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
  } catch (err) {
    // The labels are extra: one Pango can't draw must never cost the post.
    console.warn(`[feed-image] labels skipped: ${(err as Error)?.message ?? err}`)
    return plain()
  }
}

type CleanLabels = { sizes: string[]; price: FeedPriceLabel | null; sku: string | null }

function cleanLabels(opts: FeedPhotoLabels): CleanLabels {
  const price = opts.price && Number.isFinite(opts.price.price_mur) && opts.price.price_mur > 0 ? opts.price : null
  return {
    sizes: (opts.sizes ?? []).filter((s) => s.trim() !== ""),
    price,
    sku: opts.sku?.trim() || null,
  }
}

type TextImage = { input: Buffer; width: number; height: number }

function escapeMarkup(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** One line of text as a transparent PNG, trimmed to its ink so it centres optically. */
async function textImage(text: string, px: number, color: string, spacingPx = 0): Promise<TextImage> {
  const spacing = spacingPx ? ` letter_spacing="${Math.round(spacingPx * 1024)}"` : ""
  return markupImage(`<span foreground="${color}"${spacing}>${escapeMarkup(text)}</span>`, px, SANS_FONT)
}

/** Pango markup as a transparent PNG, trimmed to its ink. Falls back to a system font if the file is missing. */
async function markupImage(markup: string, px: number, font: FontChoice): Promise<TextImage> {
  const hasFont = existsSync(font.file)
  const rendered = await sharp({
    text: {
      text: markup,
      font: `${hasFont ? font.family : font.fallback} ${px}`,
      ...(hasFont ? { fontfile: font.file } : {}),
      rgba: true,
      dpi: 72,
    },
  })
    .png()
    .toBuffer()
  // Crop to the ink by alpha. sharp's trim() takes the top-left pixel as the
  // background, and for letters like L or M that pixel is ink.
  const { data, info } = await sharp(rendered).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return { input: rendered, width: info.width, height: info.height }
  const width = maxX - minX + 1
  const height = maxY - minY + 1
  const input = await sharp(rendered).extract({ left: minX, top: minY, width, height }).png().toBuffer()
  return { input, width, height }
}

type ChipLayout = {
  step: (typeof CHIP_STEPS)[number]
  labels: TextImage[]
  /** Chip indexes per line, top line first. */
  lines: number[][]
}

/** Never narrower than tall, so a one-letter size sits in a circle. */
function chipWidth(label: TextImage, step: ChipLayout["step"]): number {
  return Math.max(label.width + step.pad * 2, step.height)
}

function lineWidth(indexes: number[], labels: TextImage[], step: ChipLayout["step"]): number {
  return (
    indexes.reduce((sum, i) => sum + chipWidth(labels[i], step), 0) +
    step.gap * Math.max(0, indexes.length - 1)
  )
}

/** Biggest chips that fit on one line; else the smallest chips over as many lines as needed. */
async function layoutChips(sizes: string[]): Promise<ChipLayout> {
  const room = CHIPS_RIGHT_LIMIT - CHIPS_LEFT
  const all = sizes.map((_, i) => i)
  let last: { step: ChipLayout["step"]; labels: TextImage[] } | null = null
  for (const step of CHIP_STEPS) {
    const labels = await Promise.all(sizes.map((s) => textImage(s, step.text, INK)))
    if (lineWidth(all, labels, step) <= room) return { step, labels, lines: [all] }
    last = { step, labels }
  }
  const { step, labels } = last!
  const lines: number[][] = [[]]
  for (const i of all) {
    const current = lines[lines.length - 1]
    if (current.length > 0 && lineWidth([...current, i], labels, step) > room) lines.push([i])
    else current.push(i)
  }
  return { step, labels, lines }
}

type LabelPart = { svg: string[]; images: sharp.OverlayOptions[] }

/**
 * Every label as composite layers over a 1080x1350 photo. Each part (sizes,
 * price, code pill) is drawn on its own: one that can't be drawn is left out
 * and the others still go on.
 */
async function labelLayers(labels: CleanLabels): Promise<sharp.OverlayOptions[]> {
  const W = FEED_IMAGE_WIDTH
  const H = FEED_IMAGE_HEIGHT
  const sizes = labels.sizes.length > 0 ? await tryPart("size row", () => sizeRow(labels.sizes)) : null
  const price = labels.price
    ? await tryPart("price", () => priceText(labels.price!, priceBottom(sizes?.top ?? null)))
    : null
  const pill = labels.sku ? await tryPart("code pill", () => codePill(labels.sku!)) : null
  if (!sizes && !price && !pill) return []

  const svg: string[] = []
  let defs = ""
  if (sizes || price) {
    // The price needs the catalogue card's taller, darker fade to read over a light photo.
    const fade = price ? FADE_WITH_PRICE : FADE_SIZES_ONLY
    const stops = [0, 0.25, 0.5, 0.75, 1]
      .map(
        (t) =>
          `<stop offset="${t}" stop-color="${INK}" stop-opacity="${(fade.max * t ** fade.curve).toFixed(3)}"/>`,
      )
      .join("")
    defs = `<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>`
    svg.push(`<rect x="0" y="${H - fade.height}" width="${W}" height="${fade.height}" fill="url(#fade)"/>`)
  }
  for (const part of [sizes, price, pill]) if (part) svg.push(...part.svg)

  return [
    {
      input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${defs}\n${svg.join("\n")}\n</svg>`),
      top: 0,
      left: 0,
    },
    ...(sizes?.images ?? []),
    ...(price?.images ?? []),
    ...(pill?.images ?? []),
  ]
}

async function tryPart<T>(name: string, draw: () => Promise<T>): Promise<T | null> {
  try {
    return await draw()
  } catch (err) {
    console.warn(`[feed-image] ${name} skipped: ${(err as Error)?.message ?? err}`)
    return null
  }
}

/** Gold line, "SIZES" and the chips. `top` = the top of the highest chip line. */
async function sizeRow(sizes: string[]): Promise<LabelPart & { top: number }> {
  const { step, labels, lines } = await layoutChips(sizes)

  const svg: string[] = [
    `<rect x="${GOLD_LINE.left}" y="${GOLD_LINE.y - GOLD_LINE.thickness / 2}" width="${GOLD_LINE.width}" height="${GOLD_LINE.thickness}" fill="${GOLD}"/>`,
  ]
  const images: sharp.OverlayOptions[] = []
  let rowTop = FEED_IMAGE_HEIGHT
  lines.forEach((line, lineIndex) => {
    const fromBottom = lines.length - 1 - lineIndex
    const centreY = ROW_CENTRE_Y - fromBottom * (step.height + LINE_GAP)
    const top = Math.round(centreY - step.height / 2)
    rowTop = Math.min(rowTop, top)
    let x = CHIPS_LEFT
    for (const i of line) {
      const w = chipWidth(labels[i], step)
      svg.push(
        `<rect x="${x}" y="${top}" width="${w}" height="${step.height}" rx="${step.height / 2}" fill="${CREAM}" fill-opacity="${CHIP_OPACITY}"/>`,
      )
      images.push({
        input: labels[i].input,
        left: Math.round(x + (w - labels[i].width) / 2),
        top: Math.round(centreY - labels[i].height / 2),
      })
      x += w + step.gap
    }
  })

  const label = await textImage("SIZES", LABEL_PX, GOLD_LIGHT, LABEL_SPACING_PX)
  images.unshift({ input: label.input, left: LABEL_LEFT, top: Math.round(ROW_CENTRE_Y - label.height / 2) })
  return { svg, images, top: rowTop }
}

/**
 * Where the price's ink ends: 40 px above the gold line, as on the catalogue
 * card, and clear of a size row that wraps onto more lines. Lower when there
 * is no size row.
 */
function priceBottom(sizeRowTop: number | null): number {
  if (sizeRowTop == null) return FEED_IMAGE_HEIGHT - PRICE_BOTTOM_NO_SIZES
  return Math.min(GOLD_LINE.y - PRICE_GAP_ABOVE_LINE, sizeRowTop - PRICE_GAP_ABOVE_CHIPS)
}

/** "Rs 975" in the serif; "From Rs 975", or "Rs 683 ~~Rs 975~~" on sale. */
async function priceText(price: FeedPriceLabel, bottom: number): Promise<LabelPart> {
  const room = FEED_IMAGE_WIDTH - PRICE_LEFT - PRICE_RIGHT_MARGIN
  let text: TextImage | null = null
  for (const px of PRICE_PX_STEPS) {
    const small = Math.round(px * PRICE_SMALL_RATIO * 1024)
    const markup =
      (price.from ? `<span size="${small}" foreground="${GOLD_LIGHT}">From </span>` : "") +
      `<span weight="bold" foreground="${WHITE}">${escapeMarkup(formatRs(price.price_mur))}</span>` +
      (price.was_mur
        ? `<span size="${small}">  </span><span size="${small}" foreground="${GOLD_LIGHT}" strikethrough="true" strikethrough_color="${GOLD_LIGHT}">${escapeMarkup(formatRs(price.was_mur))}</span>`
        : "")
    text = await markupImage(markup, px, SERIF_FONT)
    if (text.width <= room) break
  }
  const shadow = await softShadow(text!)
  return {
    svg: [],
    images: [
      { input: shadow.input, left: PRICE_LEFT - shadow.pad, top: Math.round(bottom - text!.height) - shadow.pad + 2 },
      { input: text!.input, left: PRICE_LEFT, top: Math.round(bottom - text!.height) },
    ],
  }
}

/** A blurred dark copy of the text, so white type still reads where the photo is light. */
async function softShadow(text: TextImage): Promise<{ input: Buffer; pad: number }> {
  const pad = SHADOW_BLUR * 3
  const input = await sharp(text.input)
    .ensureAlpha()
    // Ink-coloured, at a fraction of the text's own alpha.
    .linear([0, 0, 0, SHADOW_OPACITY], [0x1a, 0x12, 0x12, 0])
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(SHADOW_BLUR)
    .png()
    .toBuffer()
  return { input, pad }
}

/** Dark pill with a thin gold edge, top right: the code customers quote in a DM. */
async function codePill(code: string): Promise<LabelPart> {
  const text = await textImage(code, PILL.text, WHITE, PILL.spacing)
  const w = text.width + PILL.pad * 2
  const x = FEED_IMAGE_WIDTH - PILL.margin - w
  const y = PILL.margin
  return {
    svg: [
      `<rect x="${x}" y="${y}" width="${w}" height="${PILL.height}" rx="${PILL.height / 2}" fill="${INK}" fill-opacity="${PILL.fillOpacity}" stroke="${GOLD_LIGHT}" stroke-opacity="${PILL.strokeOpacity}" stroke-width="${PILL.stroke}"/>`,
    ],
    images: [
      {
        input: text.input,
        left: Math.round(x + (w - text.width) / 2),
        top: Math.round(y + (PILL.height - text.height) / 2),
      },
    ],
  }
}

/**
 * Same photo + same day + same labels = same key, so the 18:20/18:40 retries
 * overwrite one file, and a changed size row, price or code never reuses an old copy.
 */
export function feedImageKey(
  postDate: string,
  sourceUrl: string,
  sizes: string[] = [],
  labels: { price?: FeedPriceLabel | null; sku?: string | null } = {},
): string {
  let source = sizes.length > 0 ? `${sourceUrl}|${sizes.join(",")}` : sourceUrl
  if (labels.price) {
    const { price_mur, from, was_mur } = labels.price
    source += `|p:${from ? "from-" : ""}${price_mur}${was_mur ? `/was-${was_mur}` : ""}`
  }
  if (labels.sku) source += `|k:${labels.sku}`
  const hash = createHash("sha1").update(source).digest("hex").slice(0, 16)
  return `feed/${postDate}/${hash}-${KEY_VERSION}.jpg`
}

export async function fetchImageBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { "User-Agent": "DollUpFeedPost/1.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

export type PrepareFeedImagesDeps = {
  postDate: string
  fetchImage?: (url: string) => Promise<Buffer>
  upload?: (obj: { key: string; body: Buffer; contentType: string }) => Promise<string>
  /** The sizes drawn on each photo; none = no size row. */
  sizesFor?: (url: string) => string[]
  /** The price drawn on each photo; none = no price. */
  priceFor?: (url: string) => FeedPriceLabel | null
  /** The product code drawn top right on every photo; none = no pill. */
  sku?: string | null
}

/**
 * Returns the public URLs of the JPEG copies, in the same order. A photo that
 * can't be fetched or read is skipped; if none is left, this throws.
 */
export async function prepareFeedImages(
  urls: string[],
  deps: PrepareFeedImagesDeps,
): Promise<string[]> {
  const fetchImage = deps.fetchImage ?? fetchImageBytes
  const upload = deps.upload ?? uploadPublicObject
  const out: string[] = []
  let firstError: Error | null = null
  for (const url of urls) {
    try {
      const sizes = deps.sizesFor?.(url) ?? []
      const price = deps.priceFor?.(url) ?? null
      const sku = deps.sku ?? null
      const body = await normalizeFeedImage(await fetchImage(url), { sizes, price, sku })
      out.push(await upload({ key: feedImageKey(deps.postDate, url, sizes, { price, sku }), body, contentType: "image/jpeg" }))
    } catch (err) {
      firstError ??= err as Error
    }
  }
  if (out.length === 0) {
    throw new Error(`No feed photo could be prepared: ${firstError?.message ?? "no photos"}`)
  }
  return out
}
