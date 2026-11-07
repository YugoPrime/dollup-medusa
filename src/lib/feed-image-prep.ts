import { createHash } from "node:crypto"
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
 */

export const FEED_IMAGE_WIDTH = 1080
export const FEED_IMAGE_HEIGHT = 1350
const JPEG_QUALITY = 88
const BACKDROP_BLUR = 40
/** Bump when the drawing changes, so cached copies on the CDN aren't reused. */
const KEY_VERSION = "v1"
const FETCH_TIMEOUT_MS = 30_000

export async function normalizeFeedImage(input: Buffer): Promise<Buffer> {
  // Transparent areas go white first, so the photo and its backdrop agree.
  const flat = await sharp(input).rotate().flatten({ background: "#ffffff" }).toBuffer()
  const backdrop = await sharp(flat)
    .resize(FEED_IMAGE_WIDTH, FEED_IMAGE_HEIGHT, { fit: "cover" })
    .blur(BACKDROP_BLUR)
    .toBuffer()
  const photo = await sharp(flat)
    .resize(FEED_IMAGE_WIDTH, FEED_IMAGE_HEIGHT, { fit: "inside" })
    .toBuffer()
  return sharp(backdrop)
    .composite([{ input: photo, gravity: "centre" }])
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer()
}

/** Same photo + same day = same key, so the 18:20/18:40 retries overwrite one file. */
export function feedImageKey(postDate: string, sourceUrl: string): string {
  const hash = createHash("sha1").update(sourceUrl).digest("hex").slice(0, 16)
  return `feed/${postDate}/${hash}-${KEY_VERSION}.jpg`
}

async function fetchImageBytes(url: string): Promise<Buffer> {
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
      const body = await normalizeFeedImage(await fetchImage(url))
      out.push(await upload({ key: feedImageKey(deps.postDate, url), body, contentType: "image/jpeg" }))
    } catch (err) {
      firstError ??= err as Error
    }
  }
  if (out.length === 0) {
    throw new Error(`No feed photo could be prepared: ${firstError?.message ?? "no photos"}`)
  }
  return out
}
