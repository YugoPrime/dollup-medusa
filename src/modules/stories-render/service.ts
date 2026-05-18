import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { applyAudioToRender } from "./audio-mixer"
import { resolveRenderFps, spawnRender } from "./hyperframes-runner"
import { renderHash, r2KeyFor } from "./idempotency"
import { listTemplates, loadTemplate } from "./template-loader"
import type { RenderRequest, RenderResult, TemplateMeta } from "./types"

export type R2Uploader = (localPath: string, key: string) => Promise<string>

type ServiceOptions = {
  templatesRoot?: string
  uploadToR2?: R2Uploader
  skipCli?: boolean
}

export class RequiredSlotEmptyError extends Error {
  name = "RequiredSlotEmptyError"
}

export class TextOverrideTooLongError extends Error {
  name = "TextOverrideTooLongError"
}

export default class StoriesRenderModuleService {
  private readonly templatesRoot: string
  private readonly skipCli: boolean
  uploadToR2: R2Uploader | null

  // Medusa registers module services with awilix in PROXY mode: the first
  // constructor arg is the container proxy, the second is the plain options
  // object from medusa-config. We ignore the container and read options from
  // the second arg. Touching properties of the proxy (even via `?.`) would
  // trigger awilix to resolve those names from the container and crash boot.
  constructor(_container: unknown, opts: ServiceOptions = {}) {
    const o = opts ?? {}
    this.templatesRoot = o.templatesRoot ?? path.resolve(process.cwd(), "src/story-templates")
    this.uploadToR2 = o.uploadToR2 ?? null
    this.skipCli = o.skipCli ?? false
  }

  async list(): Promise<TemplateMeta[]> {
    return listTemplates(this.templatesRoot)
  }

  async get(slug: string): Promise<TemplateMeta> {
    return loadTemplate(slug, this.templatesRoot)
  }

  async materializeTemplate(
    slug: string,
    req: Omit<RenderRequest, "template_slug">,
  ): Promise<string> {
    const meta = await this.get(slug)
    this.validateInputs(meta, req)

    const root = await fs.mkdtemp(path.join(os.tmpdir(), `hf-${slug}-`))
    const templateDst = path.join(root, slug)
    await fs.cp(path.join(this.templatesRoot, slug), templateDst, { recursive: true })
    await fs.cp(path.join(this.templatesRoot, "_brand"), path.join(root, "_brand"), {
      recursive: true,
    })

    const indexPath = path.join(templateDst, "index.html")
    let html = await fs.readFile(indexPath, "utf8")

    for (const slot of meta.slots) {
      const url = req.slot_inputs[slot.id]
      if (url) html = injectImageSrc(html, slot.id, url)
    }
    for (const override of meta.text_overrides) {
      html = injectText(
        html,
        override.id,
        req.text_overrides[override.id] ?? override.default,
      )
    }

    await fs.writeFile(indexPath, html)
    return templateDst
  }

  async render(slotId: string, req: RenderRequest): Promise<RenderResult> {
    if (this.skipCli) throw new Error("skipCli=true; render() must not be called")
    if (!this.uploadToR2) throw new Error("uploadToR2 not configured")

    const startedAt = Date.now()
    const meta = await this.get(req.template_slug)
    const tmpTemplateDir = await this.materializeTemplate(req.template_slug, {
      slot_inputs: req.slot_inputs,
      text_overrides: req.text_overrides,
    })
    const rootDir = path.dirname(tmpTemplateDir)
    const outPath = path.join(rootDir, "render.mp4")

    try {
      // 180s default. Cold-start renders need ~45-60s just for chrome-headless-shell
      // launch + page calibration + capturing 150-240 frames + ffmpeg encode. Add a
      // safety margin so the first render after a Coolify rebuild doesn't get
      // SIGKILL'd. Override with RENDER_TIMEOUT_MS env var when tuning.
      const timeoutMs = Number.parseInt(
        process.env.RENDER_TIMEOUT_MS ?? "180000",
        10,
      )
      await spawnRender({ tmpDir: tmpTemplateDir, outPath, timeoutMs })

      // Mix a brand audio track under the silent render. Graceful no-op if
      // no tracks are in _brand/audio/; logs and continues on mix error so a
      // silent MP4 still ships rather than failing the whole render.
      try {
        await applyAudioToRender({
          slotId,
          videoPath: outPath,
          durationSeconds: meta.duration_seconds,
          audioDir: path.join(this.templatesRoot, "_brand", "audio"),
        })
      } catch (audioErr) {
        console.error("[stories-render] audio mix failed, shipping silent MP4:", (audioErr as Error).message)
      }

      const mp4Url = await this.uploadToR2(outPath, r2KeyFor(slotId, renderHash(req)))
      return {
        mp4_url: mp4Url,
        template_slug: req.template_slug,
        slot_inputs: req.slot_inputs,
        text_overrides: req.text_overrides,
        generated_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        width: 1080,
        height: 1920,
        fps: resolveRenderFps(),
      }
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true })
    }
  }

  private validateInputs(
    meta: TemplateMeta,
    req: Omit<RenderRequest, "template_slug">,
  ): void {
    for (const slot of meta.slots) {
      if (slot.required && !req.slot_inputs[slot.id]) {
        throw new RequiredSlotEmptyError(`Required slot '${slot.id}' is empty`)
      }
    }
    for (const override of meta.text_overrides) {
      const value = req.text_overrides[override.id]
      if (value !== undefined && value.length > override.max_chars) {
        throw new TextOverrideTooLongError(
          `Text override '${override.id}' exceeds ${override.max_chars} chars`,
        )
      }
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function injectImageSrc(html: string, slotId: string, url: string): string {
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

function injectText(html: string, overrideId: string, value: string): string {
  const re = new RegExp(
    `(data-hf-text="${escapeRegExp(overrideId)}"[^>]*>)([^<]*)(<)`,
    "g",
  )
  return html.replace(re, `$1${escapeHtml(value)}$3`)
}
