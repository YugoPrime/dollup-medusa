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

async function main() {
  const svc = new StoriesRenderModuleService(null, { templatesRoot: ROOT, skipCli: true })
  const templates = await svc.list()
  for (const template of templates) {
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
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
