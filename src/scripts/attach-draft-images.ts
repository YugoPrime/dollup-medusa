import fs from "node:fs"
import path from "node:path"
import { SOURCING_MODULE } from "../modules/sourcing"
import type SourcingModuleService from "../modules/sourcing/service"
import { uploadDraftImage } from "../lib/sourcing/r2-upload"
import { optimizeImage } from "../lib/sourcing/optimize-image"

/**
 * Batch-attach final product photos to a sourcing draft's items, matching files
 * to items by REF. Replaces the per-item click-to-upload flow in the admin.
 *
 * Filename -> slot mapping (case-insensitive, .png/.jpg/.jpeg/.webp):
 *   IS2390.png            -> item IS2390  main image (uploaded_image_r2_key)
 *   IS2418-black.png      -> item IS2418  color image for the "Black" variant
 *                            (suffix must match one of the item's variant colors)
 *   IS2416-b.png / -1 / -r / IS2403-licking.png ...
 *                         -> NO SLOT at draft stage (only one main + one image
 *                            per color exist). Reported as "unplaceable", skipped.
 *   IS2402 (2).png        -> duplicate download, ignored.
 *
 * For a multi-color item that has color photos but no plain IS####.png, the main
 * image is set to the first color photo so the card thumbnail isn't blank.
 *
 * Uploads go straight to R2 via uploadDraftImage() — NO 2MB cap (that limit only
 * lives in the HTTP upload route, not here). Existing color_images entries that
 * aren't matched by a file are preserved; matched ones are overwritten.
 *
 * Run (loads prod DB + R2 creds from .env.local-render — DB here is PROD, so the
 * dry run is your safety net):
 *   set -a; . ./.env.local-render; set +a
 *   yarn medusa exec ./src/scripts/attach-draft-images.ts                 # DRY RUN
 *   APPLY=true yarn medusa exec ./src/scripts/attach-draft-images.ts      # WRITE
 *
 * Env flags:
 *   DRAFT_ID=dord_...   target draft (default: the After Dark draft below)
 *   IMAGE_DIR=...       folder of photos (default: the Ali29 Website folder)
 *   APPLY=true          actually upload + write; omit for a dry-run report
 */

const DEFAULT_DRAFT_ID = "dord_01KSZ7E1GE57ZZ7FWKE1KFS0BP"
const DEFAULT_IMAGE_DIR = "C:\\Users\\rahvi\\Desktop\\Ali29\\Ali29\\Website"

const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"])

type ParsedFile = {
  file: string // absolute path
  base: string // basename, e.g. IS2418-black.png
  ref: string // IS2418 (upper)
  suffix: string | null // black | b | 1 | null
}

function parseFilename(dir: string, name: string): ParsedFile | null {
  const ext = path.extname(name).toLowerCase()
  if (!IMG_EXT.has(ext)) return null
  // Skip Windows "duplicate download" copies: "IS2402 (2).png".
  if (/\(\d+\)/.test(name)) return null
  const stem = name.slice(0, -ext.length).trim()
  const m = stem.match(/^(is\d+)(?:-(.+))?$/i)
  if (!m) return null
  return {
    file: path.join(dir, name),
    base: name,
    ref: m[1].toUpperCase(),
    suffix: m[2] ? m[2].trim() : null,
  }
}

export default async function attachDraftImages({
  container,
}: {
  container: any
}) {
  const logger = container.resolve("logger")
  const service = container.resolve(SOURCING_MODULE) as SourcingModuleService

  const draftId = process.env.DRAFT_ID || DEFAULT_DRAFT_ID
  const imageDir = process.env.IMAGE_DIR || DEFAULT_IMAGE_DIR
  const apply = process.env.APPLY === "true"
  // Optional: only (re)process these refs, e.g. REFS=IS2416,IS2447. Useful for
  // re-uploading a corrected photo without touching the other items.
  const refsFilter = (process.env.REFS || "").trim()
    ? new Set(
        process
          .env.REFS!.split(",")
          .map((r) => r.trim().toUpperCase())
          .filter(Boolean),
      )
    : null

  logger.info(
    `attach-draft-images: draft=${draftId} dir=${imageDir} mode=${apply ? "APPLY" : "DRY-RUN"}${refsFilter ? ` refs=${[...refsFilter].join(",")}` : ""}`,
  )

  if (!fs.existsSync(imageDir)) {
    logger.error(`Image dir not found: ${imageDir}`)
    return
  }

  // 1. Load draft items + their variant colors. Build ref -> item map.
  const items = await service.listItems(draftId)
  if (items.length === 0) {
    logger.error(`No items on draft ${draftId} (wrong DRAFT_ID, or empty draft)`)
    return
  }
  type ItemInfo = {
    id: string
    ref: string
    name: string
    published: boolean
    // lowercased color -> actual variant color name
    colors: Map<string, string>
    existingColorImages: Record<string, string>
  }
  const byRef = new Map<string, ItemInfo>()
  for (const it of items) {
    if (!it.ref) continue
    const variants = await service.listVariants(it.id)
    const colors = new Map<string, string>()
    for (const v of variants) {
      if (v.color && v.color.trim()) colors.set(v.color.toLowerCase(), v.color)
    }
    byRef.set(it.ref.toUpperCase(), {
      id: it.id,
      ref: it.ref.toUpperCase(),
      name: it.working_name ?? "",
      published: !!it.published_product_id,
      colors,
      existingColorImages: (it.color_images as Record<string, string>) ?? {},
    })
  }

  // 2. Parse the folder and build a per-item plan.
  type Plan = {
    item: ItemInfo
    mainFile?: ParsedFile
    colorFiles: Map<string, ParsedFile> // actual color name -> file
  }
  const plans = new Map<string, Plan>()
  const noItem: string[] = []
  const unplaceable: { base: string; reason: string }[] = []

  const names = fs.readdirSync(imageDir).sort()
  for (const name of names) {
    const pf = parseFilename(imageDir, name)
    if (!pf) continue
    if (refsFilter && !refsFilter.has(pf.ref)) continue
    const item = byRef.get(pf.ref)
    if (!item) {
      noItem.push(pf.base)
      continue
    }
    let plan = plans.get(item.ref)
    if (!plan) {
      plan = { item, colorFiles: new Map() }
      plans.set(item.ref, plan)
    }
    if (pf.suffix === null) {
      plan.mainFile = pf
    } else {
      const actual = item.colors.get(pf.suffix.toLowerCase())
      if (actual) {
        plan.colorFiles.set(actual, pf)
      } else {
        unplaceable.push({
          base: pf.base,
          reason: `suffix "${pf.suffix}" is not a variant color of ${item.ref} (colors: ${[...item.colors.values()].join(", ") || "none"})`,
        })
      }
    }
  }

  // 3. Report the plan.
  let willMain = 0
  let willColor = 0
  let lockedSkipped = 0
  const lines: string[] = []
  for (const ref of [...plans.keys()].sort()) {
    const plan = plans.get(ref)!
    if (plan.item.published) {
      lockedSkipped++
      lines.push(`  ${ref}  LOCKED (published) — skipped`)
      continue
    }
    const colorList = [...plan.colorFiles.entries()]
    // multi-color w/o a plain main -> borrow first color photo as the main thumb
    const borrowedMain =
      !plan.mainFile && colorList.length > 0 ? colorList[0] : null
    const mainDesc = plan.mainFile
      ? `main=${plan.mainFile.base}`
      : borrowedMain
        ? `main=${borrowedMain[1].base} (borrowed from "${borrowedMain[0]}")`
        : "main=— (none)"
    if (plan.mainFile || borrowedMain) willMain++
    willColor += colorList.length
    const colorDesc =
      colorList.length > 0
        ? `colors: ${colorList.map(([c, f]) => `${c}=${f.base}`).join(", ")}`
        : "colors: —"
    lines.push(`  ${ref}  ${mainDesc}  |  ${colorDesc}`)
  }

  logger.info(
    `\n=== PLAN (${plans.size} items matched) ===\n${lines.join("\n")}`,
  )
  logger.info(
    `Totals: ${willMain} main images, ${willColor} color images${lockedSkipped ? `, ${lockedSkipped} locked/skipped` : ""}`,
  )
  if (noItem.length) {
    logger.warn(
      `\n${noItem.length} files have NO matching item on this draft (skipped):\n  ${noItem.join("\n  ")}`,
    )
  }
  if (unplaceable.length) {
    logger.warn(
      `\n${unplaceable.length} files have no slot (back/alt/mode shots — the draft model has no gallery; skipped):\n  ${unplaceable.map((u) => `${u.base} — ${u.reason}`).join("\n  ")}`,
    )
  }

  if (!apply) {
    logger.info(
      "\nDRY RUN — nothing uploaded or written. Re-run with APPLY=true to commit.",
    )
    return
  }

  // 4. APPLY: upload each unique file once, then patch items.
  const keyCache = new Map<string, string>() // absPath -> R2 key
  async function ensureUploaded(pf: ParsedFile): Promise<string> {
    const cached = keyCache.get(pf.file)
    if (cached) return cached
    const opt = await optimizeImage(pf.file)
    const { key } = await uploadDraftImage({
      draftId,
      filename: opt.rename(pf.base),
      contentType: opt.contentType,
      body: opt.body,
    })
    keyCache.set(pf.file, key)
    return key
  }

  let doneMain = 0
  let doneColor = 0
  for (const ref of [...plans.keys()].sort()) {
    const plan = plans.get(ref)!
    if (plan.item.published) continue

    const patch: {
      uploaded_image_r2_key?: string
      color_images?: Record<string, string>
    } = {}

    const colorList = [...plan.colorFiles.entries()]

    // color images — merge onto existing, overwrite matched colors
    if (colorList.length > 0) {
      const merged = { ...plan.item.existingColorImages }
      for (const [color, pf] of colorList) {
        merged[color] = await ensureUploaded(pf)
        doneColor++
      }
      patch.color_images = merged
    }

    // main image
    const mainSource =
      plan.mainFile ?? (colorList.length > 0 ? colorList[0][1] : null)
    if (mainSource) {
      patch.uploaded_image_r2_key = await ensureUploaded(mainSource)
      doneMain++
    }

    if (Object.keys(patch).length === 0) continue
    await service.updateItem(plan.item.id, patch)
    logger.info(`  ✓ ${ref}  ${Object.keys(patch).join(", ")}`)
  }

  logger.info(
    `\nDONE: ${doneMain} main + ${doneColor} color images uploaded & attached across ${plans.size} items.`,
  )
}
