import type { ExecArgs } from "@medusajs/framework/types"
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import StoriesRenderModuleService from "../modules/stories-render/service"

const execFileP = promisify(execFile)
const ROOT = path.resolve(process.cwd(), "src/story-templates")
const HYPERFRAMES_CLI = path.resolve(process.cwd(), "node_modules/hyperframes/dist/cli.js")
const SAMPLE_IMAGE =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#f4c2c2"/>
          <stop offset="1" stop-color="#f5e6d8"/>
        </linearGradient>
      </defs>
      <rect width="1080" height="1920" fill="url(#g)"/>
      <rect x="180" y="290" width="720" height="1160" rx="320" fill="#fff8f0" opacity=".9"/>
      <text x="540" y="1520" text-anchor="middle" font-family="Arial" font-size="74" font-weight="700" fill="#2b2b2b">IS2364</text>
    </svg>
  `)
const SAMPLE_TEXT: Record<string, string> = {
  headline: "IN STOCK",
  subhead: "MUST HAVE",
  footer: "DM to ORDER",
  price: "Rs.1100",
  sku: "IS2364",
  size: "Size: S, M, L",
  old_price: "Rs.1500",
  new_price: "Rs.1100",
  status: "IN STOCK",
  step1: "1. DM us on Instagram",
  step2: "2. Send size + address",
  step3: "3. Delivery in 24h, COD",
}

async function regenPreviews(filterSlugs: string[] = []): Promise<void> {
  // The service doesn't need DI/DB/Redis — pass null + skipCli so it
  // operates purely on the templatesRoot filesystem.
  const svc = new StoriesRenderModuleService(null, { templatesRoot: ROOT, skipCli: true })
  const templates = await svc.list()
  const filter = new Set(filterSlugs)
  const targets = filter.size > 0
    ? templates.filter((t) => filter.has(t.slug))
    : templates
  if (filter.size > 0 && targets.length === 0) {
    console.warn(`[regen] no templates matched filter: ${[...filter].join(", ")}`)
    return
  }
  for (const template of targets) {
    const slotInputs = Object.fromEntries(
      template.slots.map((slot) => [slot.id, SAMPLE_IMAGE]),
    )
    const tmpDir = await svc.materializeTemplate(template.slug, {
      slot_inputs: slotInputs,
      text_overrides: SAMPLE_TEXT,
    })
    const previewPath = path.join(ROOT, template.slug, "preview.jpg")
    const snapshotDir = path.join(tmpDir, "snapshots")
    try {
      console.log(`[regen] ${template.slug}`)
      await execFileP(process.execPath, [
        HYPERFRAMES_CLI,
        "snapshot",
        tmpDir,
        "--at",
        "0.5",
      ])
      const [snapshot] = await fs.readdir(snapshotDir)
      const pngPath = path.join(snapshotDir, snapshot)
      const jpgTmp = path.join(os.tmpdir(), `${template.slug}-preview.jpg`)
      await execFileP("ffmpeg", ["-y", "-i", pngPath, "-q:v", "3", jpgTmp])
      await fs.copyFile(jpgTmp, previewPath)
      await fs.rm(jpgTmp, { force: true })
    } finally {
      await fs.rm(path.dirname(tmpDir), { recursive: true, force: true })
    }
  }
  console.log(`[regen] done — ${targets.length} preview(s) written`)
}

// Default export so `yarn medusa exec ./src/scripts/regen-template-previews.ts`
// works (when a DB is available — medusa exec always boots the container).
//
// For local one-off runs without a DB, prefer the standalone path below:
//   yarn ts-node ./src/scripts/regen-template-previews.ts [slug...]
// Or via npx:
//   npx ts-node src/scripts/regen-template-previews.ts new-drop-arch
export default async function regenTemplatePreviews(_args: ExecArgs) {
  // `medusa exec` swallows positional args after the script path. Read filter
  // slugs from process.argv (works for both ts-node + medusa-exec paths).
  const slugs = process.argv.slice(2).filter((a) => !a.startsWith("-") && !a.endsWith(".ts"))
  await regenPreviews(slugs)
}

// Standalone runner: invoked when you run this file directly with ts-node
// (no `medusa exec`, no DB boot). require.main === module is the canonical
// "am I the entry point" check in CommonJS, which is what ts-node uses by
// default for .ts files compiled from this tsconfig (module: Node16).
const isEntryPoint =
  typeof require !== "undefined" && require.main === module
if (isEntryPoint) {
  const slugs = process.argv.slice(2).filter((a) => !a.startsWith("-"))
  regenPreviews(slugs).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
