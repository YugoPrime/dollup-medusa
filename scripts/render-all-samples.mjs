#!/usr/bin/env node
/* eslint-disable */
/**
 * One-shot batch renderer that pairs every template under src/story-templates
 * with realistic photos from IS2316, IS2337, IS2375, and IS1738 (cutout). Drops
 * render-sample-<slug>.mp4 at the repo root for visual review.
 *
 * Picks images per template so each one gets the slot kinds it expects: the
 * multi-color templates use IS2337 (beige + pink, both with backs), the
 * 1-color templates use IS2316 (blue, has back), cutout-spotlight uses
 * IS1738's known cutout PNG. how-to-order has no image slots.
 *
 * Sequential render — HyperFrames CLI is single-process anyway, and we want
 * to surface per-template failures without aborting the whole batch.
 *
 * Usage:
 *   node scripts/render-all-samples.mjs                 # renders every template
 *   node scripts/render-all-samples.mjs in-stock-hero   # only the named one(s)
 */
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, "..")
const TEMPLATES_ROOT = path.join(REPO_ROOT, "src/story-templates")
const SAMPLE_SCRIPT = path.join(__dirname, "render-sample-mp4.mjs")

const CDN = "https://cdn.dollupboutique.com/products"

// Real product photo URLs resolved from the storefront API on 2026-05-19.
// All filenames use the long-form convention (-front/-back/-real/-detail).
const IMG = {
  is2316: {
    blue: {
      front: `${CDN}/is2316/is2316-s-blue-front.jpg`,
      back: `${CDN}/is2316/is2316-s-blue-back.jpg`,
      detail: `${CDN}/is2316/is2316-s-blue-detail.jpg`,
    },
  },
  is2337: {
    beige: {
      front: `${CDN}/is2337/is2337-s-beige-front.jpg`,
      back: `${CDN}/is2337/is2337-s-beige-back.jpg`,
    },
    pink: {
      front: `${CDN}/is2337/is2337-s-pink-front.jpg`,
      back: `${CDN}/is2337/is2337-s-pink-back.jpg`,
    },
  },
  is2375: {
    red: {
      front: `${CDN}/is2375/is2375-m-red-front.jpg`,
      back: `${CDN}/is2375/is2375-m-red-back.jpg`,
      detail: `${CDN}/is2375/is2375-m-red-detail.jpg`,
    },
  },
  is1738: {
    cutout: `${CDN}/is1738/IS1738-yellow-cutout.png`,
    front: `${CDN}/is1738/is1738-m-yellow-front.jpg`,
  },
}

// Per-template slot overrides. Anything not listed renders with the script's
// built-in placeholder SVG fallback.
const PLANS = {
  "on-sale": { hero: IMG.is2316.blue.front },
  "in-stock-hero": { hero: IMG.is2316.blue.front },
  "in-stock-hero-blush": { hero: IMG.is2375.red.front },
  "in-stock-hero-cream": { hero: IMG.is2337.beige.front },
  "new-arrival": { hero: IMG.is2337.pink.front },
  "lifestyle-overlay": { lifestyle: IMG.is2375.red.front },
  "cutout-spotlight": { product_cutout: IMG.is1738.cutout },
  "product-1color": {
    front: IMG.is2316.blue.front,
    back: IMG.is2316.blue.back,
  },
  "product-2colors": {
    front_a: IMG.is2337.beige.front,
    front_b: IMG.is2337.pink.front,
    back: IMG.is2337.beige.back,
  },
  "product-2colors-front": {
    front_a: IMG.is2337.beige.front,
    front_b: IMG.is2337.pink.front,
  },
  // No 3rd color in the chosen products; reuse IS2316 blue as the third
  // panel so we still get a valid render to audit the layout.
  "product-3colors": {
    front_a: IMG.is2337.beige.front,
    front_b: IMG.is2337.pink.front,
    front_c: IMG.is2316.blue.front,
    back: IMG.is2337.beige.back,
  },
  // many-photos needs 8 image slots. Mix of front/back/detail across products.
  "many-photos": {
    photo_1: IMG.is2337.beige.front,
    photo_2: IMG.is2337.pink.front,
    photo_3: IMG.is2316.blue.front,
    photo_4: IMG.is2337.beige.back,
    photo_5: IMG.is2316.blue.detail,
    photo_6: IMG.is2375.red.detail,
    photo_7: IMG.is2337.beige.back,
    photo_8: IMG.is2316.blue.detail,
  },
  "customer-review": { product_photo: IMG.is2316.blue.front },
  "how-to-order": {}, // text-only
}

async function listAllSlugs() {
  const entries = await fs.readdir(TEMPLATES_ROOT, { withFileTypes: true })
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort()
}

function renderOne(slug, overrides) {
  return new Promise((resolve) => {
    const args = [SAMPLE_SCRIPT, slug]
    for (const [k, v] of Object.entries(overrides ?? {})) {
      args.push(`${k}=${v}`)
    }
    const t0 = Date.now()
    console.log(`\n[batch] ▶ ${slug}`)
    const child = spawn(process.execPath, args, { stdio: "inherit" })
    child.on("exit", (code) => {
      const ms = Date.now() - t0
      if (code === 0) {
        console.log(`[batch] ✓ ${slug} in ${(ms / 1000).toFixed(1)}s`)
        resolve({ slug, ok: true, ms })
      } else {
        console.log(`[batch] ✗ ${slug} (exit ${code}) in ${(ms / 1000).toFixed(1)}s`)
        resolve({ slug, ok: false, ms, code })
      }
    })
    child.on("error", (err) => {
      console.log(`[batch] ✗ ${slug} spawn error: ${err.message}`)
      resolve({ slug, ok: false, ms: Date.now() - t0, error: err.message })
    })
  })
}

async function main() {
  const arg = process.argv.slice(2)
  const allSlugs = await listAllSlugs()
  const targets = arg.length > 0 ? arg.filter((s) => allSlugs.includes(s)) : allSlugs
  if (arg.length > 0 && targets.length !== arg.length) {
    const missing = arg.filter((s) => !allSlugs.includes(s))
    console.error(`Unknown template(s): ${missing.join(", ")}`)
    console.error(`Available: ${allSlugs.join(", ")}`)
    process.exit(2)
  }

  console.log(`[batch] rendering ${targets.length} templates`)
  const results = []
  for (const slug of targets) {
    const overrides = PLANS[slug]
    if (overrides === undefined) {
      console.log(`[batch] · ${slug}: no plan defined, rendering with placeholders`)
    }
    results.push(await renderOne(slug, overrides ?? {}))
  }

  console.log("\n[batch] === summary ===")
  for (const r of results) {
    const tag = r.ok ? "✓" : "✗"
    console.log(`  ${tag} ${r.slug}${r.ok ? "" : ` (${r.code ?? r.error})`}`)
  }
  const failed = results.filter((r) => !r.ok)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error("[batch] fatal:", err.message ?? err)
  process.exit(1)
})
