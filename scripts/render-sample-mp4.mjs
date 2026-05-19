#!/usr/bin/env node
/* eslint-disable */
/**
 * One-shot local renderer for a story template — bypasses Medusa, DB, R2.
 * Outputs render-sample-<slug>.mp4 in the dollup-medusa folder so you can
 * eyeball the template visually before pushing.
 *
 * Usage:
 *   node scripts/render-sample-mp4.mjs <slug>
 *   node scripts/render-sample-mp4.mjs product-2colors
 *
 * Requires: ffmpeg on PATH. HyperFrames will auto-download chrome-headless-shell
 * to ~/.cache/puppeteer/ on first run (~150 MB).
 */
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import { readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, "..")
const TEMPLATES_ROOT = path.join(REPO_ROOT, "src/story-templates")
const HYPERFRAMES_CLI = path.join(REPO_ROOT, "node_modules/hyperframes/dist/cli.js")

const slug = process.argv[2]
if (!slug) {
  console.error("Usage: node scripts/render-sample-mp4.mjs <slug> [slot=path|url ...]")
  console.error("Example: node scripts/render-sample-mp4.mjs product-2colors front_a=./img/a.jpg back=./img/b.jpg")
  process.exit(2)
}

// Optional positional args of form `slot=local/path/or/url.jpg` override the
// placeholder SVG for that slot. Local paths are read and inlined as data URIs.
const slotOverrides = {}
for (const arg of process.argv.slice(3)) {
  const eq = arg.indexOf("=")
  if (eq < 0) continue
  const key = arg.slice(0, eq)
  const value = arg.slice(eq + 1)
  slotOverrides[key] = value
}

function inlineAsDataUri(filePath) {
  const buf = readFileSync(filePath)
  const ext = path.extname(filePath).toLowerCase().slice(1)
  const mime =
    ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
    ext === "png" ? "image/png" :
    ext === "webp" ? "image/webp" :
    ext === "avif" ? "image/avif" :
    "application/octet-stream"
  return `data:${mime};base64,${buf.toString("base64")}`
}

function resolveSlotValue(value) {
  if (/^https?:|^data:/.test(value)) return value
  return inlineAsDataUri(path.resolve(value))
}

const SAMPLE_IMAGE =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">
       <defs>
         <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
           <stop offset="0" stop-color="#f4c2c2"/>
           <stop offset="1" stop-color="#f5e6d8"/>
         </linearGradient>
       </defs>
       <rect width="1080" height="1920" fill="url(#g)"/>
       <rect x="180" y="290" width="720" height="1160" rx="320" fill="#fff8f0" opacity=".9"/>
       <text x="540" y="1520" text-anchor="middle" font-family="Arial" font-size="74" font-weight="700" fill="#2b2b2b">IS2364</text>
     </svg>`,
  )

// Per-slot realistic test values. Anything not listed here falls back to the
// template's own default from meta.json — so each template renders with its
// proper headline, kicker, etc. instead of being polluted by a global override.
const SAMPLE_TEXT = {
  footer: "DM to ORDER",
  price: "Rs.1100",
  sku: "IS2364",
  size: "Size: S, M, L",
  old_price: "Rs.1500",
  new_price: "Rs.1100",
}

function escapeHtml(v) {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
function escapeAttr(v) {
  return escapeHtml(v).replace(/"/g, "&quot;")
}
function escapeRegExp(v) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function injectImageSrc(html, slotId, url) {
  const re = new RegExp(
    `<img\\b(?=[^>]*\\bdata-hf-image="${escapeRegExp(slotId)}")[^>]*>`,
    "g",
  )
  return html.replace(re, (tag) => {
    const safe = escapeAttr(url)
    if (/\ssrc="[^"]*"/.test(tag)) return tag.replace(/\ssrc="[^"]*"/, ` src="${safe}"`)
    return tag.replace(/\s*\/?>$/, (end) => ` src="${safe}"${end}`)
  })
}

function injectText(html, id, value) {
  const re = new RegExp(
    `(data-hf-text="${escapeRegExp(id)}"[^>]*>)([^<]*)(<)`,
    "g",
  )
  return html.replace(re, `$1${escapeHtml(value)}$3`)
}

async function main() {
  const templateSrc = path.join(TEMPLATES_ROOT, slug)
  const meta = JSON.parse(await fs.readFile(path.join(templateSrc, "meta.json"), "utf8"))

  const root = await fs.mkdtemp(path.join(os.tmpdir(), `hf-sample-${slug}-`))
  const tmpTemplate = path.join(root, slug)
  await fs.cp(templateSrc, tmpTemplate, { recursive: true })
  await fs.cp(path.join(TEMPLATES_ROOT, "_brand"), path.join(root, "_brand"), {
    recursive: true,
  })

  const indexPath = path.join(tmpTemplate, "index.html")
  let html = await fs.readFile(indexPath, "utf8")
  for (const slot of meta.slots) {
    const override = slotOverrides[slot.id]
    const src = override ? resolveSlotValue(override) : SAMPLE_IMAGE
    html = injectImageSrc(html, slot.id, src)
  }
  for (const ov of meta.text_overrides) {
    html = injectText(html, ov.id, SAMPLE_TEXT[ov.id] ?? ov.default)
  }
  await fs.writeFile(indexPath, html)

  const outPath = path.join(REPO_ROOT, `render-sample-${slug}.mp4`)
  console.log(`[sample] tmp template dir: ${tmpTemplate}`)
  console.log(`[sample] output: ${outPath}`)

  const cliArgs = [
    HYPERFRAMES_CLI,
    "render",
    tmpTemplate,
    "-o",
    outPath,
    "--quiet",
    "--fps",
    "30",
    "--quality",
    "standard",
    "--workers",
    "1",
    "--max-concurrent-renders",
    "1",
    "--no-browser-gpu",
  ]
  console.log(`[sample] spawning: node ${cliArgs.join(" ")}`)

  const child = spawn(process.execPath, cliArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      HYPERFRAMES_NO_UPDATE_CHECK: "1",
      PRODUCER_FORCE_SCREENSHOT: process.env.PRODUCER_FORCE_SCREENSHOT ?? "true",
      PRODUCER_MAX_CONCURRENT_RENDERS: "1",
    },
  })

  await new Promise((resolve, reject) => {
    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`hyperframes exited with code ${code}`))
    })
  })

  console.log(`[sample] DONE → ${outPath}`)
}

main().catch((err) => {
  console.error("[sample] FAIL:", err.message ?? err)
  process.exit(1)
})
