import fs from "node:fs"
import path from "node:path"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import { SOURCING_MODULE } from "../modules/sourcing"
import type SourcingModuleService from "../modules/sourcing/service"
import { uploadDraftImage } from "../lib/sourcing/r2-upload"
import { optimizeImage } from "../lib/sourcing/optimize-image"

/**
 * STAGE 3 (run AFTER pushing a draft to Medusa). Appends the extra product
 * shots that the draft model can't hold — back / alt / real-life — to each
 * pushed product's image gallery.
 *
 * The draft carries only one main + one image per color. Push therefore builds
 * the gallery as [front, color1, color2, …] and sets each color variant's
 * image. This script adds the rest, producing the final PDP order:
 *
 *   front  →  back (-b)  →  alt (-1)  →  real (-r)  →  color shots  →  color-backs
 *
 * It REUSES the front + color URLs already on the product (uploaded once by
 * Stage 1 / push — keeps variant.metadata.image_urls consistent) and only
 * uploads the new extras. Optimized to JPEG ≤1600px like Stage 1.
 *
 * Filename suffixes (case-insensitive):
 *   IS####.png         front  (already on product — reused, not re-uploaded)
 *   IS####-b.png       back
 *   IS####-1.png       alt / extra SKU shot
 *   IS####-r.png       real-life shot
 *   IS####-<color>.png color variant image (already on product — reused)
 *   IS####-<color>-b.png  back view of that color → appended after colors
 *
 * Run (loads prod DB + R2 creds from .env.local-render — DB is PROD):
 *   set -a; . ./.env.local-render; set +a
 *   yarn medusa exec ./src/scripts/attach-product-gallery.ts                # DRY RUN
 *   APPLY=true yarn medusa exec ./src/scripts/attach-product-gallery.ts     # WRITE
 *
 * Env flags: DRAFT_ID=dord_...  IMAGE_DIR=...  APPLY=true
 */

const DEFAULT_DRAFT_ID = "dord_01KSZ7E1GE57ZZ7FWKE1KFS0BP"
const DEFAULT_IMAGE_DIR = "C:\\Users\\rahvi\\Desktop\\Ali29\\Ali29\\Website"

const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"])

// Non-color suffix taxonomy (case-insensitive, after lowercasing):
//   b            -> back
//   1, 2, 3 ...  -> alt / extra SKU shots (numbered)
//   r, rr, rrr   -> real-life shots (more r's = later in the set)
const isBack = (s: string) => s === "b"
const isAlt = (s: string) => /^\d+$/.test(s)
const isReal = (s: string) => /^r+$/.test(s)

type ParsedFile = {
  file: string
  base: string
  ref: string
  suffix: string | null
}

function parseFilename(dir: string, name: string): ParsedFile | null {
  const ext = path.extname(name).toLowerCase()
  if (!IMG_EXT.has(ext)) return null
  if (/\(\d+\)/.test(name)) return null // skip "IS#### (2).png" dupes
  const stem = name.slice(0, -ext.length).trim()
  const m = stem.match(/^(is\d+)(?:-(.+))?$/i)
  if (!m) return null
  return {
    file: path.join(dir, name),
    base: name,
    ref: m[1].toUpperCase(),
    suffix: m[2] ? m[2].trim().toLowerCase() : null,
  }
}

export default async function attachProductGallery({
  container,
}: {
  container: any
}) {
  const logger = container.resolve("logger")
  const service = container.resolve(SOURCING_MODULE) as SourcingModuleService

  const draftId = process.env.DRAFT_ID || DEFAULT_DRAFT_ID
  const imageDir = process.env.IMAGE_DIR || DEFAULT_IMAGE_DIR
  const apply = process.env.APPLY === "true"

  logger.info(
    `attach-product-gallery: draft=${draftId} dir=${imageDir} mode=${apply ? "APPLY" : "DRY-RUN"}`,
  )
  if (!fs.existsSync(imageDir)) {
    logger.error(`Image dir not found: ${imageDir}`)
    return
  }

  // 1. Pushed items only (have a Medusa product). Map ref -> {productId, colors}.
  const items = await service.listItems(draftId)
  type ItemInfo = {
    productId: string
    ref: string
    colors: Map<string, string> // lowercased -> actual
    mainKey: string | null // uploaded_image_r2_key (front)
    colorImages: Record<string, string> // color -> R2 key
  }
  const byRef = new Map<string, ItemInfo>()
  let notPushed = 0
  for (const it of items) {
    if (!it.ref) continue
    if (!it.published_product_id) {
      notPushed++
      continue
    }
    const variants = await service.listVariants(it.id)
    const colors = new Map<string, string>()
    for (const v of variants) {
      if (v.color && v.color.trim()) colors.set(v.color.toLowerCase(), v.color)
    }
    byRef.set(it.ref.toUpperCase(), {
      productId: it.published_product_id,
      ref: it.ref.toUpperCase(),
      colors,
      mainKey: it.uploaded_image_r2_key ?? null,
      colorImages: (it.color_images as Record<string, string>) ?? {},
    })
  }
  if (byRef.size === 0) {
    logger.error(
      `No PUSHED items on draft ${draftId}. Push the draft to Medusa first, then run this.`,
    )
    return
  }

  // 2. Collect the extra shots per ref. front/color are already on the product.
  type Extras = {
    back?: ParsedFile
    alts: ParsedFile[] // -1, -2 ...
    reals: ParsedFile[] // -r, -rr, -rrr
    colorExtras: ParsedFile[] // "-<color>-b" / "-<color>-r" etc
  }
  const newExtras = (): Extras => ({ alts: [], reals: [], colorExtras: [] })
  const extrasByRef = new Map<string, Extras>()
  const noItem: string[] = []
  const unplaceable: { base: string; reason: string }[] = []

  for (const name of fs.readdirSync(imageDir).sort()) {
    const pf = parseFilename(imageDir, name)
    if (!pf) continue
    const item = byRef.get(pf.ref)
    if (!item) {
      noItem.push(pf.base)
      continue
    }
    const sfx = pf.suffix
    if (sfx === null) continue // front — already on product
    if (item.colors.has(sfx)) continue // color image — already on product

    const ex = extrasByRef.get(pf.ref) ?? newExtras()
    if (isBack(sfx)) ex.back = pf
    else if (isAlt(sfx)) ex.alts.push(pf)
    else if (isReal(sfx)) ex.reals.push(pf)
    else {
      // compound "<color>-<role>" — extra view of a specific color
      const m = sfx.match(/^(.+)-(b|r+|\d+)$/)
      if (m && item.colors.has(m[1])) {
        ex.colorExtras.push(pf)
      } else {
        unplaceable.push({
          base: pf.base,
          reason: `suffix "${sfx}" is not a color/role of ${pf.ref} (colors: ${[...item.colors.values()].join(", ") || "none"})`,
        })
        continue
      }
    }
    extrasByRef.set(pf.ref, ex)
  }

  // Sort alts numerically, reals by r-count (r < rr < rrr).
  for (const ex of extrasByRef.values()) {
    ex.alts.sort((a, b) => Number(a.suffix) - Number(b.suffix))
    ex.reals.sort((a, b) => (a.suffix?.length ?? 0) - (b.suffix?.length ?? 0))
  }

  // 3. Plan + report.
  const lines: string[] = []
  let totalExtras = 0
  for (const ref of [...byRef.keys()].sort()) {
    const ex = extrasByRef.get(ref)
    const tags: string[] = []
    if (ex?.back) tags.push("back")
    if (ex?.alts.length) tags.push(`${ex.alts.length} alt`)
    if (ex?.reals.length) tags.push(`${ex.reals.length} real`)
    if (ex?.colorExtras.length) tags.push(`${ex.colorExtras.length} color-extra`)
    if (ex)
      totalExtras +=
        (ex.back ? 1 : 0) + ex.alts.length + ex.reals.length + ex.colorExtras.length
    lines.push(`  ${ref}  +[${tags.join(", ") || "nothing new"}]`)
  }
  logger.info(`\n=== GALLERY PLAN (${byRef.size} pushed products) ===\n${lines.join("\n")}`)
  logger.info(`Total extra shots to append: ${totalExtras}`)
  if (notPushed) logger.warn(`${notPushed} draft items are NOT pushed yet — skipped (push them first).`)
  if (noItem.length)
    logger.warn(`\n${noItem.length} files match no pushed item (other draft / not pushed):\n  ${noItem.join("\n  ")}`)
  if (unplaceable.length)
    logger.warn(`\n${unplaceable.length} files unplaceable:\n  ${unplaceable.map((u) => `${u.base} — ${u.reason}`).join("\n  ")}`)

  if (!apply) {
    logger.info("\nDRY RUN — nothing uploaded or written. Re-run with APPLY=true to commit.")
    return
  }

  // 4. APPLY: rebuild each gallery from the draft item (authoritative) + folder
  // extras. front = item main image, colors = item color_images; then back / alt
  // / real / color-extras. OVERWRITES the gallery, so a prior misaligned run is
  // corrected (does not reuse the product's current — possibly wrong — images).
  const r2Base = (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, "")
  const keyUrl = (k: string) => `${r2Base}/${k}`
  async function uploadExtra(pf: ParsedFile): Promise<string> {
    const opt = await optimizeImage(pf.file)
    const { url } = await uploadDraftImage({
      draftId,
      filename: opt.rename(pf.base),
      contentType: opt.contentType,
      body: opt.body,
    })
    return url
  }

  let touched = 0
  for (const ref of [...byRef.keys()].sort()) {
    const item = byRef.get(ref)!
    const ex = extrasByRef.get(ref) ?? newExtras()

    const front = item.mainKey ? keyUrl(item.mainKey) : null
    const colorUrls = Object.values(item.colorImages).map(keyUrl)

    const inserted: string[] = []
    if (ex.back) inserted.push(await uploadExtra(ex.back))
    for (const a of ex.alts) inserted.push(await uploadExtra(a))
    for (const r of ex.reals) inserted.push(await uploadExtra(r))
    const colorExtraUrls: string[] = []
    for (const ce of ex.colorExtras) colorExtraUrls.push(await uploadExtra(ce))

    const ordered = [
      ...(front ? [front] : []),
      ...inserted,
      ...colorUrls,
      ...colorExtraUrls,
    ]
    // dedupe, preserve order
    const seen = new Set<string>()
    const finalUrls = ordered.filter((u) => u && !seen.has(u) && seen.add(u))
    if (finalUrls.length === 0) continue

    await updateProductsWorkflow(container as never).run({
      input: {
        products: [
          {
            id: item.productId,
            images: finalUrls.map((url) => ({ url })),
            ...(front ? { thumbnail: front } : {}),
          },
        ],
      },
    })
    touched++
    logger.info(`  ✓ ${ref}  gallery rebuilt -> ${finalUrls.length} images`)
  }

  logger.info(`\nDONE: updated galleries on ${touched} products.`)
}
