import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import path from "node:path"
import sharp from "sharp"

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
 * When sizes are given, the photo also gets a "SIZES" row at the bottom (soft
 * dark fade, gold line, gold label, cream chips): the look Rahvi picked for the
 * collection 30 catalogue photos on 2026-11-23, without the price.
 */

export const FEED_IMAGE_WIDTH = 1080
export const FEED_IMAGE_HEIGHT = 1350
const JPEG_QUALITY = 88
const BACKDROP_BLUR = 40
/** Bump when the drawing changes, so cached copies on the CDN aren't reused. */
const KEY_VERSION = "v2"
const FETCH_TIMEOUT_MS = 30_000

/** Inter Medium. TTF, because the live image's libvips can't read WOFF2. */
export const FEED_FONT_FILE = path.resolve(process.cwd(), "src/assets/fonts/Inter-Medium.ttf")
const FONT_FAMILY = "Inter Medium"
const FALLBACK_FONT = "sans-serif"

// The size row (approved mockup, 2026-11-25).
const INK = "#1A1212"
const GOLD = "#D4A853"
const GOLD_LIGHT = "#ECD6A0"
const CREAM = "#FDF8F7"
const CHIP_OPACITY = 0.92
const FADE_HEIGHT = 420
const FADE_MAX_OPACITY = 0.78
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

export async function normalizeFeedImage(
  input: Buffer,
  opts: { sizes?: string[] } = {},
): Promise<Buffer> {
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

  const sizes = (opts.sizes ?? []).filter((s) => s.trim() !== "")
  if (sizes.length === 0) {
    return framed.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer()
  }
  // sharp runs one composite per pipeline: settle the photo first, then draw the row.
  const base = await framed.png().toBuffer()
  return sharp(base)
    .composite(await sizeRowLayers(sizes))
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer()
}

type TextImage = { input: Buffer; width: number; height: number }

function escapeMarkup(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** One line of text as a transparent PNG, trimmed to its ink so it centres optically. */
async function textImage(text: string, px: number, color: string, spacingPx = 0): Promise<TextImage> {
  const hasFont = existsSync(FEED_FONT_FILE)
  const spacing = spacingPx ? ` letter_spacing="${Math.round(spacingPx * 1024)}"` : ""
  const rendered = await sharp({
    text: {
      text: `<span foreground="${color}"${spacing}>${escapeMarkup(text)}</span>`,
      font: `${hasFont ? FONT_FAMILY : FALLBACK_FONT} ${px}`,
      ...(hasFont ? { fontfile: FEED_FONT_FILE } : {}),
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

/** Fade, gold line, "SIZES" and the chips, as composite layers over a 1080x1350 photo. */
async function sizeRowLayers(sizes: string[]): Promise<sharp.OverlayOptions[]> {
  const W = FEED_IMAGE_WIDTH
  const H = FEED_IMAGE_HEIGHT
  const { step, labels, lines } = await layoutChips(sizes)

  const chipRects: string[] = []
  const chipTexts: sharp.OverlayOptions[] = []
  lines.forEach((line, lineIndex) => {
    const fromBottom = lines.length - 1 - lineIndex
    const centreY = ROW_CENTRE_Y - fromBottom * (step.height + LINE_GAP)
    const top = Math.round(centreY - step.height / 2)
    let x = CHIPS_LEFT
    for (const i of line) {
      const w = chipWidth(labels[i], step)
      chipRects.push(
        `<rect x="${x}" y="${top}" width="${w}" height="${step.height}" rx="${step.height / 2}" fill="${CREAM}" fill-opacity="${CHIP_OPACITY}"/>`,
      )
      chipTexts.push({
        input: labels[i].input,
        left: Math.round(x + (w - labels[i].width) / 2),
        top: Math.round(centreY - labels[i].height / 2),
      })
      x += w + step.gap
    }
  })

  // Opacity rises as t^1.3 from the top of the fade to FADE_MAX_OPACITY at the bottom edge.
  const stops = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (t) =>
        `<stop offset="${t}" stop-color="${INK}" stop-opacity="${(FADE_MAX_OPACITY * t ** 1.3).toFixed(3)}"/>`,
    )
    .join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>
<rect x="0" y="${H - FADE_HEIGHT}" width="${W}" height="${FADE_HEIGHT}" fill="url(#fade)"/>
<rect x="${GOLD_LINE.left}" y="${GOLD_LINE.y - GOLD_LINE.thickness / 2}" width="${GOLD_LINE.width}" height="${GOLD_LINE.thickness}" fill="${GOLD}"/>
${chipRects.join("\n")}
</svg>`

  const label = await textImage("SIZES", LABEL_PX, GOLD_LIGHT, LABEL_SPACING_PX)
  return [
    { input: Buffer.from(svg), top: 0, left: 0 },
    { input: label.input, left: LABEL_LEFT, top: Math.round(ROW_CENTRE_Y - label.height / 2) },
    ...chipTexts,
  ]
}

/**
 * Same photo + same day + same sizes = same key, so the 18:20/18:40 retries
 * overwrite one file, and a changed size row never reuses an old copy.
 */
export function feedImageKey(postDate: string, sourceUrl: string, sizes: string[] = []): string {
  const source = sizes.length > 0 ? `${sourceUrl}|${sizes.join(",")}` : sourceUrl
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
      const body = await normalizeFeedImage(await fetchImage(url), { sizes })
      out.push(await upload({ key: feedImageKey(deps.postDate, url, sizes), body, contentType: "image/jpeg" }))
    } catch (err) {
      firstError ??= err as Error
    }
  }
  if (out.length === 0) {
    throw new Error(`No feed photo could be prepared: ${firstError?.message ?? "no photos"}`)
  }
  return out
}
