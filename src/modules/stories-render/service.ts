import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { applyAudioToRender } from "./audio-mixer"
import { resolveRenderFps, spawnRender } from "./hyperframes-runner"
import { renderHash, r2KeyFor } from "./idempotency"
import { listTemplates, loadTemplate } from "./template-loader"
import type { RenderRequest, RenderResult, TemplateMeta } from "./types"

export type R2Uploader = (localPath: string, key: string) => Promise<string>

/**
 * Resolves a slot image URL to the string that gets written into the <img src>.
 * Production inlines the bytes as a base64 data: URI so there is zero network
 * race during the headless render (see inlineImageAsDataUri). Tests pass an
 * identity fn so the raw URL flows through and assertions stay simple.
 */
export type ImageResolver = (url: string) => Promise<string>

type ServiceOptions = {
  templatesRoot?: string
  uploadToR2?: R2Uploader
  skipCli?: boolean
  /** Override the slot-image resolver. Defaults to inlineImageAsDataUri. */
  resolveImage?: ImageResolver
}

export class RequiredSlotEmptyError extends Error {
  name = "RequiredSlotEmptyError"
}

/**
 * A required slot had an image URL, but inlining it failed every attempt (the
 * fetch fell back to the raw remote URL). HyperFrames' screenshot mode does NOT
 * wait for <img> to load, so a non-inlined required image renders as a blank
 * box. Rather than ship that, we abort — the poller will pick the slot up again
 * on its next pass, by which point the transient CDN hiccup has usually cleared.
 */
export class RequiredImageInlineFailedError extends Error {
  name = "RequiredImageInlineFailedError"
}

export class TextOverrideTooLongError extends Error {
  name = "TextOverrideTooLongError"
}

export type RenderStage =
  | "validate"
  | "load_template"
  | "materialize"
  | "spawn_render"
  | "audio_mix"
  | "r2_upload"

function logStage(
  slotId: string,
  stage: RenderStage,
  event: "start" | "done" | "skipped" | "error",
  extra: Record<string, unknown> = {},
): void {
  const payload = {
    msg: "[stories-render]",
    slotId,
    stage,
    event,
    ts: new Date().toISOString(),
    ...extra,
  }
  const line = JSON.stringify(payload)
  if (event === "error") console.error(line)
  else console.log(line)
}

function tagError(err: unknown, stage: RenderStage): never {
  if (err && typeof err === "object") {
    Object.assign(err, { renderStage: stage })
  }
  throw err
}

export default class StoriesRenderModuleService {
  private readonly templatesRoot: string
  private readonly skipCli: boolean
  private readonly resolveImage: ImageResolver
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
    this.resolveImage = o.resolveImage ?? inlineImageAsDataUri
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
      if (url) {
        // Resolve the remote URL to a data: URI BEFORE writing the HTML.
        // HyperFrames' screenshot mode only blocks frame capture on <video>
        // readyState and document.fonts — it does NOT wait for <img> to load.
        // A slow remote product photo therefore gets captured as an empty box
        // (the "frame painted, product missing" glitch). Inlining the bytes
        // removes the network race entirely.
        const resolved = await this.resolveImage(url)

        // The resolver falls back to the raw URL when inlining fails. For an
        // http(s) input, "resolved === url" therefore means we did NOT inline —
        // the image would render as a blank box. Abort required slots so the
        // poller retries rather than ship a broken story (the IS2237 incident).
        const inlineFailed = /^https?:\/\//i.test(url) && resolved === url
        if (inlineFailed && slot.required) {
          throw new RequiredImageInlineFailedError(
            `Required slot '${slot.id}' image failed to inline (${url}); aborting to avoid a blank box`,
          )
        }

        html = injectImageSrc(html, slot.id, resolved)
      }
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
    const elapsed = () => Date.now() - startedAt

    logStage(slotId, "load_template", "start", {
      template_slug: req.template_slug,
      slot_input_keys: Object.keys(req.slot_inputs ?? {}),
      text_override_keys: Object.keys(req.text_overrides ?? {}),
    })
    let meta: TemplateMeta
    try {
      meta = await this.get(req.template_slug)
    } catch (err) {
      logStage(slotId, "load_template", "error", {
        elapsed_ms: elapsed(),
        error_name: (err as Error).name,
        error_message: (err as Error).message,
      })
      tagError(err, "load_template")
    }
    logStage(slotId, "load_template", "done", {
      elapsed_ms: elapsed(),
      duration_seconds: meta.duration_seconds,
      slot_count: meta.slots.length,
      text_override_count: meta.text_overrides.length,
    })

    logStage(slotId, "materialize", "start", { elapsed_ms: elapsed() })
    let tmpTemplateDir: string
    try {
      tmpTemplateDir = await this.materializeTemplate(req.template_slug, {
        slot_inputs: req.slot_inputs,
        text_overrides: req.text_overrides,
      })
    } catch (err) {
      logStage(slotId, "materialize", "error", {
        elapsed_ms: elapsed(),
        error_name: (err as Error).name,
        error_message: (err as Error).message,
      })
      tagError(err, "materialize")
    }
    const rootDir = path.dirname(tmpTemplateDir)
    const outPath = path.join(rootDir, "render.mp4")
    logStage(slotId, "materialize", "done", {
      elapsed_ms: elapsed(),
      tmp_dir: tmpTemplateDir,
      out_path: outPath,
    })

    try {
      // 180s default. Cold-start renders need ~45-60s just for chrome-headless-shell
      // launch + page calibration + capturing 150-240 frames + ffmpeg encode. Add a
      // safety margin so the first render after a Coolify rebuild doesn't get
      // SIGKILL'd. Override with RENDER_TIMEOUT_MS env var when tuning.
      const timeoutMs = Number.parseInt(
        process.env.RENDER_TIMEOUT_MS ?? "180000",
        10,
      )
      logStage(slotId, "spawn_render", "start", {
        elapsed_ms: elapsed(),
        timeout_ms: timeoutMs,
      })
      try {
        await spawnRender({ tmpDir: tmpTemplateDir, outPath, timeoutMs, slotId })
      } catch (err) {
        const e = err as { name?: string; message?: string; stderrTail?: string; exitCode?: number }
        logStage(slotId, "spawn_render", "error", {
          elapsed_ms: elapsed(),
          error_name: e.name,
          error_message: e.message,
          exit_code: e.exitCode,
          stderr_tail: e.stderrTail,
        })
        tagError(err, "spawn_render")
      }
      logStage(slotId, "spawn_render", "done", { elapsed_ms: elapsed() })

      // Mix a brand audio track under the silent render. Graceful no-op if
      // no tracks are in _brand/audio/; logs and continues on mix error so a
      // silent MP4 still ships rather than failing the whole render.
      logStage(slotId, "audio_mix", "start", { elapsed_ms: elapsed() })
      try {
        const trackName = await applyAudioToRender({
          slotId,
          videoPath: outPath,
          durationSeconds: meta.duration_seconds,
          audioDir: path.join(this.templatesRoot, "_brand", "audio"),
          planId: req.plan_id,
          slotIndex: req.slot_index,
        })
        logStage(slotId, "audio_mix", trackName ? "done" : "skipped", {
          elapsed_ms: elapsed(),
          track: trackName,
        })
      } catch (audioErr) {
        // Audio failure is non-fatal — ship the silent MP4 instead.
        logStage(slotId, "audio_mix", "skipped", {
          elapsed_ms: elapsed(),
          reason: "mix_failed",
          error_message: (audioErr as Error).message,
        })
      }

      logStage(slotId, "r2_upload", "start", { elapsed_ms: elapsed() })
      let mp4Url: string
      try {
        mp4Url = await this.uploadToR2(outPath, r2KeyFor(slotId, renderHash(req)))
      } catch (err) {
        logStage(slotId, "r2_upload", "error", {
          elapsed_ms: elapsed(),
          error_name: (err as Error).name,
          error_message: (err as Error).message,
        })
        tagError(err, "r2_upload")
      }
      logStage(slotId, "r2_upload", "done", {
        elapsed_ms: elapsed(),
        mp4_url: mp4Url,
      })

      return {
        mp4_url: mp4Url,
        template_slug: req.template_slug,
        slot_inputs: req.slot_inputs,
        text_overrides: req.text_overrides,
        generated_at: new Date().toISOString(),
        duration_ms: elapsed(),
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

const IMAGE_FETCH_TIMEOUT_MS = 20_000
const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024 // 25MB safety cap
const IMAGE_INLINE_MAX_ATTEMPTS = 3 // initial try + 2 retries
const IMAGE_INLINE_RETRY_BASE_MS = 500 // backoff: 500ms, 1000ms

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Outcome of a single inline attempt. `data:` URIs mean success. A `retryable`
 * failure (network throw, timeout, 5xx, empty body) is worth another try — these
 * are exactly the transient CDN hiccups that produced blank product photos in a
 * posted story (IS2237, 2026-06-02: a brief `cdn.dollupboutique.com` outage made
 * fetches fail for 2 of 3 slots). A `permanent` failure (4xx, oversized, non-image
 * body) will never change, so we stop immediately.
 */
type InlineOutcome =
  | { kind: "ok"; dataUri: string }
  | { kind: "retryable"; reason: string }
  | { kind: "permanent"; reason: string }

async function attemptInline(url: string): Promise<InlineOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      // 5xx is a server hiccup worth retrying; 4xx is a real miss, give up.
      return res.status >= 500
        ? { kind: "retryable", reason: `http_${res.status}` }
        : { kind: "permanent", reason: `http_${res.status}` }
    }

    const headerType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0) {
      return { kind: "retryable", reason: "empty_body" }
    }
    if (buf.byteLength > MAX_INLINE_IMAGE_BYTES) {
      return { kind: "permanent", reason: `too_large_${buf.byteLength}` }
    }

    const mime = headerType.startsWith("image/") ? headerType : sniffImageMime(buf)
    if (!mime) {
      return { kind: "permanent", reason: `not_image_${headerType || "unknown"}` }
    }

    return { kind: "ok", dataUri: `data:${mime};base64,${buf.toString("base64")}` }
  } catch (err) {
    // Fetch throws (DNS, ECONNRESET, "socket hang up") and aborts (timeout) are
    // transient — retry them.
    return {
      kind: "retryable",
      reason: (err as Error).name === "AbortError" ? "timeout" : (err as Error).message,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetches a remote image and returns it as a base64 `data:` URI so it can be
 * embedded directly in the template HTML. Eliminates the render-time network
 * race that left product photos blank in some stories.
 *
 * Non-http(s) inputs (already a data: URI, a local path, or a test sentinel
 * like "x") are returned unchanged. Transient failures are retried up to
 * {@link IMAGE_INLINE_MAX_ATTEMPTS} times with backoff. If every attempt fails
 * we fall back to the original URL — but callers that care (required slots in
 * materialize) detect this by comparing the result against the input and fail
 * the render rather than ship a blank box. See {@link materializeTemplate}.
 */
export async function inlineImageAsDataUri(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return url

  let lastReason = "unknown"
  for (let attempt = 1; attempt <= IMAGE_INLINE_MAX_ATTEMPTS; attempt++) {
    const outcome = await attemptInline(url)
    if (outcome.kind === "ok") return outcome.dataUri

    lastReason = outcome.reason
    if (outcome.kind === "permanent") break

    if (attempt < IMAGE_INLINE_MAX_ATTEMPTS) {
      logInlineWarn(url, `${outcome.reason}_retry_${attempt}`)
      await sleep(IMAGE_INLINE_RETRY_BASE_MS * attempt)
    }
  }

  logInlineWarn(url, lastReason)
  return url
}

/**
 * Best-effort magic-byte sniff for the common product-photo formats. Used only
 * when the server sends a missing/generic content-type (e.g. octet-stream from
 * some Drive/R2 responses). Returns null for anything we can't positively
 * identify so the caller falls back to the raw URL rather than guessing wrong.
 */
function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg"
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  ) return "image/png"
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP")
    return "image/webp"
  if (buf.length >= 6 && buf.toString("ascii", 0, 6) === "GIF89a") return "image/gif"
  if (buf.length >= 6 && buf.toString("ascii", 0, 6) === "GIF87a") return "image/gif"
  return null
}

function logInlineWarn(url: string, reason: string): void {
  console.warn(
    JSON.stringify({
      msg: "[stories-render] image inline fell back to remote URL",
      reason,
      url,
      ts: new Date().toISOString(),
    }),
  )
}

function injectText(html: string, overrideId: string, value: string): string {
  const re = new RegExp(
    `(data-hf-text="${escapeRegExp(overrideId)}"[^>]*>)([^<]*)(<)`,
    "g",
  )
  return html.replace(re, `$1${escapeHtml(value)}$3`)
}
