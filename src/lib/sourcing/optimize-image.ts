import sharp from "sharp"
import fs from "node:fs"

/**
 * Optimize a product photo for upload: downscale + re-encode as JPEG.
 *
 * - Source files here are 1–3.4 MB PNG/JPG screenshots; a PDP hero only renders
 *   ~800px, so 1600px (retina) is plenty and cuts size ~90%.
 * - JPEG (not WebP) because the Meta Commerce Catalog feed serves these URLs and
 *   is safest with JPEG/PNG. White-bg product shots → flatten transparency.
 */

const MAX_EDGE = 1600
const JPEG_QUALITY = 82

export type OptimizedImage = {
  body: Buffer
  contentType: string
  ext: string
  /** filename with the original extension swapped for the optimized one */
  rename: (originalName: string) => string
}

export async function optimizeImage(filePath: string): Promise<OptimizedImage> {
  const input = fs.readFileSync(filePath)
  const body = await sharp(input)
    .rotate() // honor EXIF orientation before stripping metadata
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer()
  return {
    body,
    contentType: "image/jpeg",
    ext: ".jpg",
    rename: (originalName: string) => originalName.replace(/\.[^.]+$/, ".jpg"),
  }
}
